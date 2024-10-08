const dayjs = require('dayjs');
const { createLimiter, newLarkClient ,batchOperation,sleep} = require('../../utils');
const _ = application.operator;

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info(`批量创建门店任务开始执行`, params);

    const { task_def_record } = params;
    if (!task_def_record) {
        logger.warn('未传入有效的任务定义记录');
        return { code: -1, message: '未传入有效的任务定义记录' };
    }


    const client = await newLarkClient({ userId: context.user._id }, logger);
    logger.info('Lark 客户端初始化完成', client);


    // 1. 第一步根据任务定义列表创建任务处理记录（任务批次）
    // 为任务定义实例记录生成任务批次号并创建任务处理记录（任务批次）
    const taskBatchNumberCreateResult = await createSecondLevelTaskBatch(task_def_record, logger);

    if (taskBatchNumberCreateResult.code !== 0) {
        logger.error('任务处理记录（任务批次）生成失败', taskBatchNumberCreateResult);
        return { code: -2, message: '任务处理记录（任务批次）生成失败' + taskBatchNumberCreateResult.message };
    }

    //创建限流器
    const limitedSendFeishuMessage = createLimiter(sendFeishuMessage, {perSecond: 30, perMinute: 600});

    //2.  第二步根据任务定义，创建抄送人aPaaS数据，给抄送人发送飞书消息
    if (task_def_record.carbon_copy) {
        logger.info('任务定义内的抄送人数据', task_def_record.carbon_copy);
        const carbonCopy = task_def_record.carbon_copy;
        const userList = await faas.function('DeployMemberRange').invoke({ user_rule: carbonCopy, publisher: task_def_record.task_publisher });

        if (userList.length > 0) {
            const res = await getTaskDefCopyAndFeishuMessageStructure(userList, task_def_record, taskBatchNumberCreateResult.object_task_create_monitor, logger);

            const cardDataList = res.cardDataList;
            const sendFeishuMessageResults = await Promise.all(cardDataList.map(item => limitedSendFeishuMessage(item, client)));
            const sendFeishuMessageSuccess = sendFeishuMessageResults.filter(result => result.code === 0);
            const sendFeishuMessageFail = sendFeishuMessageResults.filter(result => result.code !== 0);
            logger.info(`抄送人飞书消息发送结果，总数${sendFeishuMessageResults.length}，成功${sendFeishuMessageSuccess.length}，失败${sendFeishuMessageFail.length}`);

            const aPaaSDataList = res.aPaaSDataList;
            const createAPaaSDataResults = await Promise.all(aPaaSDataList.map(item => createAPaaSData(item)));
            const createAPaaSDataSuccess = createAPaaSDataResults.filter(result => result.code === 0);
            const createAPaaSDataFail = createAPaaSDataResults.filter(result => result.code !== 0);
            logger.info(`抄送人aPaaS数据创建结果，总数${createAPaaSDataResults.length}，成功${createAPaaSDataSuccess.length}，失败${createAPaaSDataFail.length}`);
        }
    }

    // 3. 第三步根据任务处理记录（任务批次）创建门店普通任务
    //创建门店普通任务

    // 删除任务批次号的redis缓存
    await baas.redis.del(taskBatchNumberCreateResult?.task_id);

    // 调用创建门店普通任务函数
    const storeTaskCreateResults = await batchCreateThirdLevelStoreTask(task_def_record, taskBatchNumberCreateResult.object_task_create_monitor, logger, limitedSendFeishuMessage, client, context);

    return {
        code: storeTaskCreateResults.code,
        message: '任务处理记录（任务批次）生成完成',
        data: storeTaskCreateResults,
    };
};

/**
 * @description 创建任务批次记录
 * @param {*} taskDefine
 * @param {*} logger
 * @returns
 */
async function createSecondLevelTaskBatch(taskDefine, logger) {
    try {
        const { batch_no, batch_progress } = await faas.function('TaskGetBatchNumber').invoke({ object_task_def: taskDefine });

        if ((!batch_no, !batch_progress)) {
            logger.error('任务批次号生成失败');
            return { code: -1, message: '任务批次号生成失败', task_id: taskDefine._id, task: taskDefine.task_number };
        }

        // 判断 Redis 中是否含有任务定义主键
        const value = await baas.redis.get(taskDefine._id);

        if (value != null) {
            logger.warn(`任务定义: ${taskDefine._id} (${taskDefine.task_number})的任务处理记录（任务批次）正在执行中...`, taskDefine.task_number);
            return {
                code: -1,
                message: `任务定义: ${taskDefine._id} (${taskDefine.task_number})的任务处理记录（任务批次）正在生成中...`,
                task_id: taskDefine._id,
            };
        }

        // 判断任务当天是否已经发送，
        const res = await application.data
            .object('object_task_create_monitor')
            .select('_id')
            .where({
                task_def: { _id: taskDefine._id },
                task_create_time: _.lte(dayjs().startOf('day').valueOf()),
            })
            .findOne();

        if (res) {
            logger.warn(`任务定义: ${taskDefine._id} (${taskDefine.task_number})的任务处理记录（任务批次）当天已存在...`);
            return {
                code: -1,
                message: `任务定义: ${taskDefine._id} (${taskDefine.task_number})的任务处理记录（任务批次）当天已存在...`,
                task_id: taskDefine._id,
            };
        }

        await baas.redis.set(taskDefine._id, batch_no);

        // 创建任务处理记录（任务批次）
        const createData = {
            task_def: { _id: taskDefine._id },
            batch_no,
            batch_progress,
            option_status: 'option_01',
            task_create_time: dayjs().valueOf(),
            publish_department: taskDefine.publish_department,
        };

        const createDataResult = await application.data.object('object_task_create_monitor').create(createData);
        createData._id = createDataResult._id;

        return {
            code: 0,
            message: `任务定义: ${taskDefine._id} (${taskDefine.task_number})的任务处理记录（任务批次）创建成功`,
            task_id: taskDefine._id,
            task_create_monitor_id: createDataResult._id,
            object_task_create_monitor: createData,
        };
    } catch (error) {
        logger.error(`创建任务处理记录（任务批次）[${taskDefine._id}]失败-->`, error);
        return { code: -1, message: error.message, task_id: taskDefine._id };
    }
}

/**
 * @description 构造门店普通任务aPaaS数据
 * @param {*} taskDefine
 * @param {*} taskBatch
 * @param {*} logger
 * @param {*} limitedSendFeishuMessage
 * @returns
 */
async function batchCreateThirdLevelStoreTask(taskDefine, taskBatch, logger, limitedSendFeishuMessage, client, context) {
    const createDataList = [];
    logger.info('任务批量 msg：',taskBatch)

    try {
        // 因为之前获取部门名称（任务来源）一直有问题，这里增加功能，单独去找部门名称
        let sourceDepartmentName = '';
        if (taskDefine.publish_department._id || taskDefine.publish_department.id) {
            const sourceDepartment = await application.data
                .object('_department')
                .select('_name')
                .where({ _id: taskDefine.publish_department._id || taskDefine.publish_department.id })
                .findOne();
            logger.info(sourceDepartment);
            sourceDepartmentName =
                sourceDepartment?._name?.find(item => item.language_code === 2052)?.text || sourceDepartment?._name?.find(item => item.language_code === 1033)?.text || '未知部门';
        } else {
            logger.warn('任务定义内的发布部门为空');
        }

        const task_plan_time = dayjs(taskBatch.task_create_time).add(taskDefine.deal_duration, 'day').valueOf();

        const department_record = taskDefine.publish_department;

        const chatRecordDetailList = [];

        // option_01 代表任务处理人类型为门店，option_02 代表任务处理人类型为人员
        if (taskDefine.option_handler_type === 'option_01') {
            const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: taskDefine.chat_rule });

            if (chatRecordList.length === 0) {
                logger.warn('根据任务定义群组筛选规则查询结果为空');
                return { code: -1, message: '根据任务定义群组筛选规则查询结果为空' };
            }

            let chatRecordIdList = chatRecordList.map(item => item._id);

            // 批量查询，获取群组详情
            await application.data
                .object('object_feishu_chat')
                .select('_id', 'department',"chat_id")
                .where({ _id: _.in(chatRecordIdList) })
                .findStream(async records => {
                    chatRecordDetailList.push(...records);
                });

            for (const chatRecordListElement of chatRecordList) {
                let createData;
                // 判断为一次性任务还是周期期任务，存储的任务截止日期处理逻辑不同
                if (taskDefine.option_method === 'option_once'){
                    createData = {
                        name: taskDefine.name,
                        description: taskDefine.description,
                        task_def: {_id: taskDefine._id},
                        task_monitor: {_id: taskBatch._id},
                        task_status: 'option_pending',
                        task_create_time: taskBatch.task_create_time,
                        task_plan_time: taskDefine.onetime_task_endtime,
                        is_overdue: 'option_no',
                        option_upload_image: taskDefine.option_upload_image,
                        option_input_information: taskDefine.option_input_information,
                        option_upload_attachment: taskDefine.option_upload_attachment,
                        set_warning_time: taskDefine.set_warning_time,
                        warning_time: taskDefine.warning_time,
                        source_department: {
                            _id: department_record._id || department_record.id,
                            _name: department_record._name
                        },
                        option_priority: taskDefine.option_priority,
                        task_chat: {_id: chatRecordListElement._id},
                        overdue_reminders: 'option_no',
                    };
                }else {
                    createData = {
                        name: taskDefine.name,
                        description: taskDefine.description,
                        task_def: {_id: taskDefine._id},
                        task_monitor: {_id: taskBatch._id},
                        task_status: 'option_pending',
                        task_create_time: taskBatch.task_create_time,
                        task_plan_time: task_plan_time,
                        is_overdue: 'option_no',
                        option_upload_image: taskDefine.option_upload_image,
                        option_input_information: taskDefine.option_input_information,
                        option_upload_attachment: taskDefine.option_upload_attachment,
                        set_warning_time: taskDefine.set_warning_time,
                        warning_time: taskDefine.warning_time,
                        source_department: {
                            _id: department_record._id || department_record.id,
                            _name: department_record._name
                        },
                        option_priority: taskDefine.option_priority,
                        task_chat: {_id: chatRecordListElement._id},
                        overdue_reminders: 'option_no',
                    };
                }

                const feishu_chat = chatRecordDetailList.find(item => item._id === chatRecordListElement._id);
                if (feishu_chat.department) {
                    createData.deal_department = { _id: feishu_chat.department._id || feishu_chat.department.id };
                }
                createDataList.push(createData);
            }
        } else if (taskDefine.option_handler_type === 'option_02') {
            const userList = await faas.function('DeployMemberRange').invoke({ user_rule: taskDefine.user_rule, publisher: taskDefine.task_publisher });

            if (userList.length === 0) {
                logger.warn('根据任务定义人员筛选规则查询结果为空');
                return { code: -1, message: '根据任务定义人员筛选规则查询结果为空' };
            }
            logger.info('根据任务定义人员筛选规则查询结果成功！共筛选到：',userList.length);

            let userRecordIdList = userList.map(item => item._id);

            // 批量查询，获取人员详情
            const userRecordDetailList = [];
            await application.data
                .object('_user')
                .select('_id', '_department')
                .where({ _id: _.in(userRecordIdList) })
                .findStream(async records => {
                    userRecordDetailList.push(...records);
                });
            logger.info('根据任务定义人员筛选规则查询结果成功！共筛选到：',userRecordDetailList.length,userRecordDetailList);

            for (const userListElement of userList) {
                let createData;
                // 判断为一次性任务还是周期期任务，存储的任务截止日期处理逻辑不同
                if (taskDefine.option_method === 'option_once') {
                    createData = {
                        name: taskDefine.name,
                        description: taskDefine.description,
                        task_def: {_id: taskDefine._id},
                        task_monitor: {_id: taskBatch._id},
                        task_status: 'option_pending',
                        task_create_time: taskBatch.task_create_time,
                        task_plan_time: taskDefine.onetime_task_endtime,
                        is_overdue: 'option_no',
                        option_upload_image: taskDefine.option_upload_image,
                        option_input_information: taskDefine.option_input_information,
                        option_upload_attachment: taskDefine.option_upload_attachment,
                        set_warning_time: taskDefine.set_warning_time,
                        warning_time: taskDefine.warning_time,
                        source_department: {
                            _id: department_record._id || department_record.id,
                            _name: department_record._name
                        },
                        option_priority: taskDefine.option_priority,
                        task_handler: {_id: userListElement._id},
                        overdue_reminders: 'option_no',
                    };
                }else {
                    createData = {
                        name: taskDefine.name,
                        description: taskDefine.description,
                        task_def: {_id: taskDefine._id},
                        task_monitor: {_id: taskBatch._id},
                        task_status: 'option_pending',
                        task_create_time: taskBatch.task_create_time,
                        task_plan_time: task_plan_time,
                        is_overdue: 'option_no',
                        option_upload_image: taskDefine.option_upload_image,
                        option_input_information: taskDefine.option_input_information,
                        option_upload_attachment: taskDefine.option_upload_attachment,
                        set_warning_time: taskDefine.set_warning_time,
                        warning_time: taskDefine.warning_time,
                        source_department: {
                            _id: department_record._id || department_record.id,
                            _name: department_record._name
                        },
                        option_priority: taskDefine.option_priority,
                        task_handler: {_id: userListElement._id},
                        overdue_reminders: 'option_no',
                    };
                }
                const user = userRecordDetailList.find(item => item._id === userListElement._id);
                // 防止出现部分用户没有部门的情况出现
                createData.deal_department = {
                    _id: user?._department?._id || user?._department?.id || {}
                };
                createDataList.push(createData);
            }
        }

        if (createDataList.length > 0) {
            logger.info(`即将创建的门店普通任务数据数据，数据总数${createDataList.length}（仅展示第一个数据）`, createDataList[0]);

            let storeTaskCreateResults = [];
            const batchSize = 30;
            for (let i = 0; i < createDataList.length; i += batchSize) {
                const batch = createDataList.slice(i, i + batchSize);
                const batchResults = await Promise.all(batch.map(task => createThirdLevelStoreTask(context, task, sourceDepartmentName, logger)));
                // logger.info(`批量创建的门店普通任务数据数据，数据总数${batchResults.length}（仅展示第一个数据）`, batchResults[0]);
                storeTaskCreateResults = [...storeTaskCreateResults, ...batchResults];
                await sleep(400);
            }

            const successfulStoreTasks = storeTaskCreateResults.filter(result => result.code === 0);
            const failedStoreTasks = storeTaskCreateResults.filter(result => result.code !== 0);

            // const messageCardSendDataList = successfulStoreTasks.map(item => item.messageCardSendData).filter(data => data && Object.keys(data).length > 0);
            const messageCardSendDataList = successfulStoreTasks.filter(data => data && Object.keys(data.messageCardSendData).length > 0);

            // 获取创建成功的门店普通任务数据，用于更新
            // const updateStoreTaskList = successfulStoreTasks.map(item => item.updateStoreTask).filter(data => data && Object.keys(data).length > 0)

            logger.info("开始发送飞书消息");
            let updateDataList = [];
            // const sendFeishuMessageResults = await Promise.all(messageCardSendDataList.map(item => limitedSendFeishuMessage(item.messageCardSendData, client))).then(result=>{
            //     result.map((item,index)=>{
            //         if (item.code === 0){
            //             updateDataList.push({
            //                 _id: messageCardSendDataList[index].updateStoreTask.id._id,
            //                 message_id: item.data.message_id,
            //             })
            //         }
            //     })
            //     logger.info(result)
            // })
            const sendFeishuMessageResults = await Promise.all(messageCardSendDataList.map(item => limitedSendFeishuMessage(item.messageCardSendData, client)));

            sendFeishuMessageResults.map((item,index)=>{
                if (item.code === 0){
                    updateDataList.push({
                        _id: messageCardSendDataList[index].storeTaskId._id,
                        task_message_id: item.data.message_id,
                    })
                }
            })

            // logger.info("messageCardSendDataList,",messageCardSendDataList)
            // logger.info("sendFeishuMessageResults,",sendFeishuMessageResults)
            const sendFeishuMessageSuccess = sendFeishuMessageResults.filter(result => result.code === 0);
            const sendFeishuMessageFail = sendFeishuMessageResults.filter(result => result.code !== 0);

            logger.info(`任务创建结果：成功创建门店普通任务数量${sendFeishuMessageSuccess.length}，失败创建门店普通任务数量${sendFeishuMessageFail.length}`,"开始创建apaas侧门店数据");

            try {
                // logger.info(`消息发送成功返回的数据:`,sendFeishuMessageSuccess[0],"即将更新的数据本体:",createDataList[0],"范围内的飞书群数据：",chatRecordDetailList[0]);
                // if (taskDefine.option_handler_type === 'option_01') {
                //     logger.info("门店侧开始执行")
                //     for (let storeTask of updateStoreTaskList) {
                //         for (let sendFeishuMessageResultItem of sendFeishuMessageSuccess) {
                //             const feishuChat = chatRecordDetailList.find(item => item.chat_id === sendFeishuMessageResultItem.receive_id);
                //             logger.info("获取到的匹配飞书群",feishuChat);
                //             if ( storeTask.targetId === feishuChat._id){
                //                 updateDataList.push({
                //                     _id: storeTask.id,
                //                     task_messsage_id: sendFeishuMessageResultItem.data.message_id
                //                 })
                //             }
                //         }
                //     }
                // }  else if (taskDefine.option_handler_type === 'option_02') {
                //
                // }
                logger.info("即将更新的数据本体",updateDataList[0]);
                await batchOperation(logger,"object_store_task","batchUpdate",updateDataList);
            }catch (e) {
                logger.error(`创建 apaas 门店数据失败：${e.message}`);
            }


            const updateData = {
                _id: taskBatch._id,
                option_status: failedStoreTasks.length > 0 ? 'option_03' : 'option_05',
                option_status_show: `任务创建${failedStoreTasks.length > 0 ? '部分成功' : '成功'}, 成功发布任务数量：${successfulStoreTasks.length}, 失败数量：${
                    failedStoreTasks.length
                }`,
            };

            if (successfulStoreTasks.length > sendFeishuMessageSuccess.length) {
                updateData.option_status_show += `, 飞书消息发送部分成功，应发送飞书消息数量：${sendFeishuMessageResults.length}, 成功数量：${sendFeishuMessageSuccess.length}, 失败数量：${sendFeishuMessageFail.length}`;
            } else {
                updateData.option_status_show += `, 飞书消息发送成功, 成功发送飞书消息数量：${sendFeishuMessageSuccess.length}`;
            }

            await application.data.object('object_task_create_monitor').update(updateData);
        } else {
            const updateData = {
                _id: taskBatch._id,
                option_status: 'option_03',
                option_status_show: '任务创建失败, 根据筛选规则查询结果为0, 请检查任务定义筛选规则',
            };
            await application.data.object('object_task_create_monitor').update(updateData);
            logger.warn('根据任务定义群组和人员筛选规则查询结果为空');
        }

        return { code: 0, message: '为任务处理记录（任务批次）组装门店普通任务成功', task_id: taskBatch._id };
    } catch (error) {
        logger.error(`为任务处理[${taskBatch._id}]记录组装门店普通任务失败-->`, error);
        const updateData = {
            _id: taskBatch._id,
            option_status: 'option_03',
            option_status_show: '任务创建失败, 内部错误',
        };
        await application.data.object('object_task_create_monitor').update(updateData);
        return { code: -1, message: error.message, task_id: taskBatch._id };
    }
}

/**
 * @description 创建门店普通任务，并发送消息
 * @param {*} storeTask
 * @param sourceDepartmentName
 * @param {*} logger
 * @returns
 */
async function createThirdLevelStoreTask(context, storeTask, sourceDepartmentName, logger) {
    // storeTask 代表门店普通任务
    try {
        const storeTaskId = await application.data.object('object_store_task').create(storeTask);

        const data = {
            receive_id_type: '',
            msg_type: 'interactive',
            receive_id: '',
            content: '',
        };

        try {
            const priority = await faas.function('GetOptionName').invoke({
                table_name: 'object_store_task',
                option_type: 'option_priority',
                option_api: storeTask.option_priority,
            });

            let atAll = {};
            if (storeTask.task_chat) {
                atAll = {
                    tag: 'markdown',
                    content: '<at id=all></at>',
                };
            }

            const { name: tenantDomain, namespace } = context.tenant;

            const url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgik5q3gyhw?params_var_bcBO3kSg=` + storeTaskId._id;
            const pc_url = url;
            const android_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgihlti4uni?params_var_LLsDqf8w=` + storeTaskId._id;
            const ios_url = android_url;
            const hourDiff = (storeTask.task_plan_time - dayjs().valueOf()) / 36e5;

            const content = {
                config: { wide_screen_mode: true },
                elements: [
                    { tag: 'div', text: { content: '任务标题：' + storeTask.name, tag: 'plain_text' } },
                    { tag: 'div', text: { content: '任务描述：' + storeTask.description, tag: 'plain_text' } },
                    { tag: 'div', text: { content: '任务优先级：' + priority.option_name, tag: 'plain_text' } },
                    { tag: 'div', text: { content: '任务来源：' + sourceDepartmentName, tag: 'plain_text' } },
                    {
                        tag: 'div',
                        text: { content: '任务下发时间：' + dayjs(storeTask.task_create_time).add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'), tag: 'plain_text' },
                    },
                    { tag: 'div', text: { content: '距离截至时间还有' + hourDiff.toFixed(2) + '小时', tag: 'plain_text' } },
                    { tag: 'hr' },
                    atAll,
                    {
                        tag: 'action',
                        actions: [
                            {
                                tag: 'button',
                                text: { tag: 'plain_text', content: '查看详情' },
                                type: 'primary',
                                multi_url: { url, pc_url, android_url, ios_url },
                            },
                        ],
                    },
                ],
                header: { template: 'turquoise', title: { content: '【任务】有一条门店任务发布！', tag: 'plain_text' } },
            };

            data.content = JSON.stringify(content);
            // logger.info('飞书消息发送内容：', data.content)

            if (storeTask.task_chat) {
                const feishuChat = await application.data.object('object_feishu_chat').select('_id', 'chat_id').where({ _id: storeTask.task_chat._id }).findOne();
                if (feishuChat) {
                    data.receive_id_type = 'chat_id';
                    data.receive_id = feishuChat.chat_id;
                } else {
                    logger.warn(`群组ID [${storeTask.task_chat._id}] 不存在`);
                    return { code: -1, message: `群组ID [${storeTask.task_chat._id}] 不存在` };
                }
            } else {
                const feishuPeople = await application.data
                    .object('_user')
                    .select('_id', '_email', '_name', '_lark_user_id', '_department')
                    .where({ _id: storeTask.task_handler._id })
                    .findOne();

                if (feishuPeople) {
                    content.header.title.content = `【任务发布】${feishuPeople._name.find(item => item.language_code === 2052).text}有一条${storeTask.name}门店任务请尽快处理！`;
                    data.content = JSON.stringify(content);

                    const object_task_def = await application.data.object('object_task_def').select('_id', 'send_channel').where({ _id: storeTask.task_def._id }).findOne();

                    if (object_task_def.send_channel === 'option_group') {
                        const object_feishu_chat = await application.data
                            .object('object_feishu_chat')
                            .select('_id', 'chat_id')
                            .where({ department: feishuPeople._department._id || feishuPeople._department.id })
                            .findOne();

                        if (object_feishu_chat) {
                            data.receive_id_type = 'chat_id';
                            data.receive_id = object_feishu_chat.chat_id;
                        } else {
                            logger.warn(`该用户 [${feishuPeople._id}] 的部门飞书群不存在`);
                            data.receive_id_type = 'user_id';
                            data.receive_id = feishuPeople._lark_user_id;
                        }
                    } else {
                        data.receive_id_type = 'user_id';
                        data.receive_id = feishuPeople._lark_user_id;
                    }
                } else {
                    logger.warn(`用户ID [${storeTask.task_handler._id}] 不存在`);
                    return { code: -1, message: `用户ID [${storeTask.task_handler._id}] 不存在` };
                }
            }

            return { code: 0, message: '创建门店普通任务成功，返回消息卡片内容', messageCardSendData: data ,storeTaskId: storeTaskId};
        } catch (error) {
            logger.error('messageCardSendData--->', JSON.stringify(data, null, 2));
            logger.error(`组装门店普通任务[${storeTask._id}]发送消息卡片失败-->`, error);
            return {
                code: 0,
                message: `创建门店普通任务成功&组装门店普通任务[${storeTask._id}]发送消息卡片失败`,
                storeTaskId: storeTaskId._id,
                messageCardSendData: {},
            };
        }
    } catch (error) {
        logger.error(`创建门店普通任务失败-->`, error);
        return { code: -1, message: '创建门店普通任务失败：' + error, task: storeTask };
    }
}

/**
 * @description 构造aPaaS抄送人数据，构造飞书消息卡片
 * @param {*} userList 用户列表
 * @param {*} taskDefRecord 任务定义
 * @param {*} taskBatch 任务批次
 * @param {*} logger 日志
 * @returns
 */
async function getTaskDefCopyAndFeishuMessageStructure(userList, taskDefRecord, taskBatch, logger) {
    logger.info('发送抄送人消息参数检测', JSON.stringify({ userList, taskDefRecord, taskBatch }, null, 2));
    const cardDataList = [];
    const aPaaSDataList = [];

    // 获取部门详情
    // 因为之前获取部门名称（任务来源）一直有问题，这里增加功能，单独去找部门名称
    let sourceDepartmentName = '';
    if (taskDefRecord.publish_department._id || taskDefRecord.publish_department.id) {
        const sourceDepartment = await application.data
            .object('_department')
            .select('_name')
            .where({ _id: taskDefRecord.publish_department._id || taskDefRecord.publish_department.id })
            .findOne();
        // logger.info(`根据任务定义[${taskDefRecord._id}]获取的部门详情`, sourceDepartment);
        sourceDepartmentName =
            sourceDepartment?._name?.find(item => item.language_code === 2052)?.text || sourceDepartment?._name?.find(item => item.language_code === 1033)?.text || '未知部门';
    } else {
        logger.warn(任务定义内的发布部门为空);
    }

    const priority = await faas.function('GetOptionName').invoke({
        table_name: 'object_task_def',
        option_type: 'option_priority',
        option_api: taskDefRecord.option_priority,
    });
    const namespace = await application.globalVar.getVar("namespace");
    const tenantDomain = await application.globalVar.getVar("tenantDomain");

    // 遍历人员
    for (const user of userList) {
        const cardData = {
            receive_id_type: 'user_id',
            msg_type: 'interactive',
            receive_id: user.user_id,
            content: '',
        };

        const default_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgkbd43lmhu?params_var_5CWWdDBS=${taskDefRecord._id || taskDefRecord.id}&params_var_M8Kd1eI6=${
            taskBatch._id || taskBatch.id
        }`;
        const mobile_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgkbfqddgbu?params_var_5CWWdDBS=${taskDefRecord._id || taskDefRecord.id}&params_var_M8Kd1eI6=${
            taskBatch._id || taskBatch.id
        }`;

        const url = default_url;
        const pc_url = default_url;
        const android_url = mobile_url;
        const ios_url = mobile_url;

        const taskPlanTime = dayjs(taskBatch.task_create_time).add(taskDefRecord.deal_duration, 'day').valueOf();
        const hourDiff = (taskPlanTime - dayjs().valueOf()) / 36e5;

        const content = {
            config: { wide_screen_mode: true },
            elements: [
                { tag: 'div', text: { content: '任务标题：' + taskDefRecord.name, tag: 'plain_text' } },
                { tag: 'div', text: { content: '任务描述：' + taskDefRecord.description, tag: 'plain_text' } },
                { tag: 'div', text: { content: '任务优先级：' + priority.option_name, tag: 'plain_text' } },
                { tag: 'div', text: { content: '任务来源：' + sourceDepartmentName, tag: 'plain_text' } },
                { tag: 'div', text: { content: '任务下发时间：' + dayjs(taskBatch.task_create_time).add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'), tag: 'plain_text' } },
                { tag: 'div', text: { content: '距离截至时间还有' + hourDiff.toFixed(2) + '小时', tag: 'plain_text' } },
                { tag: 'hr' },
                {
                    tag: 'action',
                    actions: [
                        {
                            tag: 'button',
                            text: { tag: 'plain_text', content: '查看详情' },
                            type: 'primary',
                            multi_url: { url, pc_url, android_url, ios_url },
                        },
                    ],
                },
            ],
            header: { template: 'turquoise', title: { content: '【任务抄送】有一条门店任务发布！', tag: 'plain_text' } },
        };

        cardData.content = JSON.stringify(content);
        if (cardData.receive_id) {
            cardDataList.push(cardData);
        } else {
            logger.warn('抄送人的user_id为null->', JSON.stringify(user, null, 2));
        }

        const aPaaSData = {
            task_def: { _id: taskDefRecord._id },
            task_create_monitor: { _id: taskBatch._id },
            carbon_copy: { _id: user._id },
        };
        aPaaSDataList.push({
            objectApiName: 'object_task_def_copy',
            data: aPaaSData,
        });
    }

    return { code: 0, cardDataList, aPaaSDataList };
}

/**
 * @description 发送飞书消息
 * @param {*} messageCardSendData
 * @returns
 */
const sendFeishuMessage = async (messageCardSendData, client) => {
    try {
        let result = await faas.function('MessageCardSend').invoke({ ...messageCardSendData, client });
        return result;
    } catch (error) {
        return {
            code: -1,
            message: `调用飞书消息发送函数（MessageCardSend）失败：` + error.message,
            result: 'failed',
        };
    }
};

/**
 * @description 创建aPaaS数据
 * @param {*} aPaaSData
 * @returns
 */
const createAPaaSData = async aPaaSData => {
    try {
        await application.data.object(aPaaSData.objectApiName).create(aPaaSData.data);
        return { code: 0, message: `创建aPaaS数据成功`, result: 'success' };
    } catch (error) {
        return {
            code: -1,
            message: `创建aPaaS数据失败->` + error.message,
            result: 'failed',
        };
    }
};
