// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

const dayjs = require('dayjs');
const { newLarkClient, createLimiter } = require('../../utils');
const _ = application.operator;
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    //任务处理记录
    const { object_task_create_monitor } = params;
    if (!object_task_create_monitor) {
        return { code: -1, message: '未传入有效的任务处理记录' };
    }
    const client = await newLarkClient({ userId: context.user._id }, logger);

    //任务定义
    const object_task_def = await application.data
        .object('object_task_def')
        .select(
            '_id',
            'name', //任务名称
            'task_number', //任务编码
            'description', //任务描述
            'task_tag', //任务分类（对象）
            'option_method', //任务周期（全局选项）：计划任务：option_01，一次性任务：option_02
            'option_time_cycle', //任务定义（全局选项）：天:option_day，周:option_week，月:option_month，季度:option_quarter，半年:option_half_year，年:option_year
            'repetition_rate', //重复频率
            'boolean_public_now', //是否立即发布
            'datetime_publish', //发布时间
            'datetime_start', //开始时间
            'datetime_end', //结束时间
            'deal_duration', //任务处理时长
            'option_status', //状态（全局选项）：新建:option_01，启用:option_02，禁用:option_03
            'send_channel', //发送渠道（全局选项）：发送到飞书群:option_group，发送到个人:option_user
            'option_handler_type', //任务处理人类型（全局选项）：飞书群:option_01，责任人：option_02
            'chat_rule', //群组筛选规则（对象）
            'user_rule', //人员筛选规则（对象）
            'carbon_copy', //任务抄送人（对象）
            'option_is_check', //任务是否需要验收(全局选项)：是：option_yes，否：option_no
            'check_flow', //任务验收流程(对象)
            'task_publisher', //发布人（对象）
            'publish_department', //发布人所属部门(对象)
            'option_priority', //优先级(全局选项)：高:option_01，中:option_02，低:option_03
            'option_upload_image', //任务要求上传图片
            'option_input_information', //任务要求录入完成信息
            'option_upload_attachment', //任务要求上传附件
            'is_workday_support', //是否支持工作日历 布尔
            'warning_time', //设置预警时间（小时）
            'set_warning_time', //设置任务到期前提醒
            'onetime_task_endtime', //一次性任务结束时间'
        )
        .where({ _id: object_task_create_monitor.task_def._id || object_task_create_monitor.task_def.id })
        .findOne();
    // task 代表任务处理记录
    const createDataList = [];
    //
    let task_plan_time = dayjs(object_task_create_monitor.task_create_time).add(0, 'day').valueOf();
    if (object_task_def.option_method === 'option_01' && object_task_def.deal_duration) {
         task_plan_time = dayjs(object_task_create_monitor.task_create_time).add(Number.parseInt(object_task_def.deal_duration), 'day').valueOf();
    }else if (object_task_def.option_method === 'option_02' && object_task_def.onetime_task_endtime){
        task_plan_time = object_task_def.onetime_task_endtime;
    }

    //获取部门详情
    let department_record = await application.data
        .object('_department')
        .select('_id', '_name')
        .where({ _id: object_task_def.publish_department.id || object_task_def.publish_department._id })
        .findOne();

    //飞书群
    if (object_task_def.option_handler_type === 'option_01') {
        //群组赛选规则
        const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: object_task_def.chat_rule });
        for (const chatRecordListElement of chatRecordList) {
            const createData = {
                name: object_task_def.name,
                description: object_task_def.description,
                task_def: { _id: object_task_def._id }, //任务定义
                task_monitor: { _id: object_task_create_monitor._id }, //任务创建记录
                task_status: 'option_pending',
                //其他字段
                task_create_time: object_task_create_monitor.task_create_time, //任务创建时间
                task_plan_time: task_plan_time, //要求完成时间 ===  开始时间 + 任务处理时长
                is_overdue: 'option_no', //是否超期
                option_upload_image: object_task_def.option_upload_image, //任务要求上传图片
                option_input_information: object_task_def.option_input_information, //任务要求录入完成信息
                option_upload_attachment: object_task_def.option_upload_attachment, //任务要求上传附件
                set_warning_time: object_task_def.set_warning_time, //是否设置任务到期前提醒
                warning_time: object_task_def.warning_time, //预警时间（小时）
                source_department: { _id: department_record._id, _name: department_record._name }, //任务来源
                option_priority: object_task_def.option_priority, //优先级
            };
            //为任务处理记录创建门店普通任务
            createData.task_chat = { _id: chatRecordListElement._id }; //负责群
            //查询飞书群所在部门
            const feishu_chat = await application.data.object('object_feishu_chat').select('_id', 'department').where({ _id: chatRecordListElement._id }).findOne();
            if (feishu_chat) {
                createData.deal_department = { _id: feishu_chat.department._id }; //任务所属部门
            }
            createDataList.push(createData);
        }
    } else if (object_task_def.option_handler_type === 'option_02') {
        //人员筛选规则
        const userList = await faas.function('DeployMemberRange').invoke({ user_rule: object_task_def.user_rule, publisher: object_task_def.task_publisher });
        for (const userListElement of userList) {
            const createData = {
                name: object_task_def.name,
                description: object_task_def.description,
                task_def: { _id: object_task_def._id }, //任务定义
                task_monitor: { _id: object_task_create_monitor._id }, //任务创建记录
                task_status: 'option_pending',
                //其他字段
                task_create_time: object_task_create_monitor.task_create_time, //任务创建时间
                task_plan_time: task_plan_time, //要求完成时间 ===  开始时间 + 任务处理时长
                is_overdue: 'option_no', //是否超期
                option_upload_image: object_task_def.option_upload_image, //任务要求上传图片
                option_input_information: object_task_def.option_input_information, //任务要求录入完成信息
                option_upload_attachment: object_task_def.option_upload_attachment, //任务要求上传附件
                set_warning_time: object_task_def.set_warning_time, //是否设置任务到期前提醒
                warning_time: object_task_def.warning_time, //预警时间（小时）
                source_department: { _id: department_record._id, _name: department_record._name }, //任务来源
                option_priority: object_task_def.option_priority, //优先级
            };
            //为任务处理记录创建门店普通任务
            createData.task_handler = { _id: userListElement._id }; //负责人
            //查询人员所在部门
            const user = await application.data.object('_user').select('_id', '_department').where({ _id: userListElement._id }).findOne();
            createData.deal_department = { _id: user._department._id }; //任务所属部门
            createDataList.push(createData);
        }
    }

    if (createDataList.length > 0) {
        const storeTaskCreateResults = await Promise.all(createDataList.map(object_store_task => createStoreTaskEntryStart(context, object_store_task, logger)));
        const successfulStoreTasks = storeTaskCreateResults.filter(result => result.code === 0);
        const failedStoreTasks = storeTaskCreateResults.filter(result => result.code !== 0);
        const messageCardSendDataList = [];
        storeTaskCreateResults.forEach(item => {
            if (item.messageCardSendData) {
                messageCardSendDataList.push({
                    sendMessages: item.messageCardSendData,
                    storeTaskId: item.storeTaskId,
                });
            }
        });
        //创建限流器
        const limitedSendFeishuMessage = createLimiter(sendFeishuMessage);
        //发送飞书卡片消息
        const sendFeishuMessageResults = await Promise.all(messageCardSendDataList.map(messageCardSendData => limitedSendFeishuMessage(messageCardSendData, client)));

        const sendFeishuMessageSuccess = sendFeishuMessageResults.filter(result => result.code === 0);
        const sendFeishuMessageFail = sendFeishuMessageResults.filter(result => result.code !== 0);

        //修改任务处理记录状态为处理中 =>全部成功
        if (failedStoreTasks.length === 0) {
            try {
                const updateData = {
                    _id: object_task_create_monitor._id,
                    option_status: 'option_05',
                    option_status_show: `任务创建成功,成功发布任务数量：${successfulStoreTasks.length}`,
                };
                await application.data.object('object_task_create_monitor').update(updateData);
            } catch (error) {
                logger.error(`修改任务处理记录[${object_task_create_monitor._id}]状态为处理中失败-->`, error);
            }
        } else {
            try {
                const updateData = {
                    _id: object_task_create_monitor._id,
                    option_status: 'option_03',
                    option_status_show: `任务创建部分成功,应创建任务数量：${storeTaskCreateResults.length},成功数量：${successfulStoreTasks.length},失败数量：${failedStoreTasks.length}`,
                };
                await application.data.object('object_task_create_monitor').update(updateData);
            } catch (error) {
                logger.error(`修改任务处理记录[${object_task_create_monitor._id}]状态为处理中失败-->`, error);
            }
        }
        return {
            code: successfulStoreTasks.length > 0 ? 0 : -1,
            message: '任务创建重试完成',
            data: {
                success_count: successfulStoreTasks.length,
                success_list: successfulStoreTasks,
                failed_count: failedStoreTasks.length,
                failed_list: failedStoreTasks,
            },
        };
    } else {
        logger.warn('根据任务定义群组和人员筛选规则查询结果为空');
        try {
            const updateData = {
                _id: object_task_create_monitor._id,
                option_status: 'option_03',
                option_status_show: '任务创建失败,根据筛选规则查询结果为0,请检查任务定义筛选规则',
            };
            await application.data.object('object_task_create_monitor').update(updateData);
        } catch (error) {
            logger.error(`修改任务处理记录（任务批次）[${object_task_create_monitor._id}]状态为失败失败-->`, error);
        }
        return {
            code: -1,
            message: '任务创建重试完成[根据任务定义群组和人员筛选规则查询结果为空]',
            data: {
                success_count: 0,
                success_list: [],
                failed_count: 0,
                failed_list: [],
            },
        };
    }
};

/**
 * @description 
 * @param {*} object_store_task 
 * @param {*} logger 
 * @returns 
 */
async function createStoreTaskEntryStart(context, object_store_task, logger) {
    try {
        //判断是否发送成功者，发送成功者不再发送
        let object_store_task_out = {};
        try {
            object_store_task_out = await application.data
                .object('object_store_task')
                .select('_id')
                .where({
                    task_monitor: object_store_task.task_monitor._id || object_store_task.task_monitor.id,
                    task_chat: object_store_task.task_chat._id || object_store_task.task_chat.id,
                })
                .findOne();
        } catch (error) {
            object_store_task_out = await application.data
                .object('object_store_task')
                .select('_id')
                .where({
                    task_monitor: object_store_task.task_monitor._id || object_store_task.task_monitor.id,
                    task_handler: object_store_task.task_handler._id || object_store_task.task_handler.id,
                })
                .findOne();
        }
        let storeTaskId = '';
        if (!object_store_task_out) {
            const storeTask = await application.data.object('object_store_task').create(object_store_task);
            storeTaskId = storeTask._id;
            // await faas.function('CreateFsTask').invoke({ storeTaskId: storeTask._id });
        } else {
            storeTaskId = object_store_task._id;
        }
        const data = {
            receive_id_type: '', //接收方类型：open_id/user_id/union_id/email/chat_id text
            msg_type: 'interactive', //消息类型：text、post、image、file、audio、media、sticker、interactive、share_chat、share_user text
            receive_id: '', //接收方ID text
            content: '', //消息卡片内容  JSON
        };
        // 发送消息卡片
        try {
            let priority = await faas.function('GetOptionName').invoke({
                table_name: 'object_store_task',
                option_type: 'option_priority',
                option_api: object_store_task.option_priority,
            });
            const { name: tenantDomain, namespace } = context.tenant;

            //判断执行流程的url
            const url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgik5q3gyhw?params_var_bcBO3kSg=` + storeTaskId;
            const pc_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgik5q3gyhw?params_var_bcBO3kSg=` + storeTaskId;
            const android_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgihlti4uni?params_var_LLsDqf8w=` + storeTaskId;
            const ios_url = `https://${tenantDomain}.feishuapp.cn/ae/apps/${namespace}/aadgihlti4uni?params_var_LLsDqf8w=` + storeTaskId;

            const hourDiff = (object_store_task.task_plan_time - dayjs().valueOf()) / 36e5;
            const content = {
                config: {
                    wide_screen_mode: true,
                },
                elements: [
                    {
                        tag: 'div',
                        text: {
                            content: '任务优先级：' + priority.option_name,
                            tag: 'plain_text',
                        },
                    },
                    {
                        tag: 'div',
                        text: {
                            content: '任务来源：' + object_store_task.source_department._name.find(item => item.language_code === 2052).text,
                            tag: 'plain_text',
                        },
                    },
                    {
                        tag: 'div',
                        text: {
                            content: '任务下发时间：' + dayjs(object_store_task.task_create_time).add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
                            tag: 'plain_text',
                        },
                    },
                    {
                        tag: 'div',
                        text: {
                            content: '距离截至时间还有' + hourDiff.toFixed(2) + '小时',
                            tag: 'plain_text',
                        },
                    },
                    {
                        tag: 'hr',
                    },
                    {
                        tag: 'action',
                        actions: [
                            {
                                tag: 'button',
                                text: {
                                    tag: 'plain_text',
                                    content: '查看详情',
                                },
                                type: 'primary',
                                multi_url: {
                                    url: url,
                                    pc_url: pc_url,
                                    android_url: android_url,
                                    ios_url: ios_url,
                                },
                            },
                        ],
                    },
                ],
                header: {
                    template: 'turquoise',
                    title: {
                        content: '【任务发布】有一条' + object_store_task.name + '门店任务请尽快处理！',
                        tag: 'plain_text',
                    },
                },
            };
            data.content = JSON.stringify(content);
            if (object_store_task.task_chat) {
                //获取群组ID
                const feishuChat = await application.data
                    .object('object_feishu_chat')
                    .select('_id', 'chat_id')
                    .where({ _id: object_store_task.task_chat._id || object_store_task.task_chat.id })
                    .findOne();

                data.receive_id_type = 'chat_id';
                data.receive_id = feishuChat.chat_id;
            } else {
                //通过用户
                let feishuPeople = await application.data
                    .object('_user')
                    .select('_id', '_department', '_lark_user_id')
                    .where({ _id: object_store_task.task_handler._id || object_store_task.task_handler.id })
                    .findOne();
                content.header.title.content =
                    '【任务发布】' + feishuPeople._name.find(item => item.language_code === 2052).text + '有一条' + object_store_task.name + '门店任务请尽快处理！';
                data.content = JSON.stringify(content);
                // 判断是群组发送（查询所在部门的门店群）还是机器人（机器人直发）发送
                let object_task_def = await application.data
                    .object('object_task_def')
                    .select('_id', 'send_channel')
                    .where({ _id: object_store_task.task_def._id || object_store_task.task_def.id })
                    .findOne();

                if (object_task_def.send_channel === 'option_group') {
                    //通过部门ID获取飞书群ID
                    let object_feishu_chat = await application.data
                        .object('object_feishu_chat')
                        .select('_id', 'chat_id')
                        .where({ department: feishuPeople._department._id || feishuPeople._department.id })
                        .findOne();
                    if (!object_feishu_chat) {
                        logger.warn(`该用户[${feishuPeople._id}]的部门飞书群不存在`);
                        data.receive_id_type = 'user_id';
                        data.receive_id = feishuPeople._lark_user_id;
                    } else {
                        data.receive_id_type = 'chat_id';
                        data.receive_id = object_feishu_chat.chat_id;
                    }
                } else {
                    data.receive_id_type = 'user_id';
                    data.receive_id = feishuPeople._lark_user_id;
                }
            }
            return { code: 0, message: '创建门店普通任务成功', storeTaskId: storeTaskId, messageCardSendData: data };
        } catch (error) {
            logger.error(`组装门店普通任务[${object_store_task._id}]发送消息卡片失败-->`, error);

            return {
                code: 0,
                message: `创建门店普通任务成功&组装门店普通任务[${object_store_task._id}]发送消息卡片失败`,
                storeTaskId: storeTaskId,
                messageCardSendData: {},
            };
        }
    } catch (error) {
        logger.error(`创建门店普通任务失败-->`, error);
        return { code: -1, message: '创建门店普通任务失败：' + error, task: object_store_task };
    }
}

const sendFeishuMessage = async (messageCardSendData, client) => {
    try {
        sendMessages = messageCardSendData.sendMessages;
        let result = await faas.function('MessageCardSend').invoke({ ...sendMessages, client });
        return result;
    } catch (error) {
        return {
            code: -1,
            message: `[${messageCardSendData.storeTaskId}]飞书消息发送失败：` + error.message,
            result: 'failed',
        };
    }
};
