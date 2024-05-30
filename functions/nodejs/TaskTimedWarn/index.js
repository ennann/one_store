const { createLimiter, newLarkClient } = require('../utils');
const dayjs = require('dayjs');

/**
 * @param {Params} params 自定义参数
 * @param {Context} context 上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger} logger 日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const currentTime = dayjs().valueOf(); // 当前时间时间戳
    logger.info(`当前时间戳: ${currentTime}`);

    // 从环境变量中获取租户域名和命名空间
    const domain = await application.globalVar.getVar("tenantDomain");
    const namespace = await application.globalVar.getVar("namespace");
    

    // 查询符合条件的门店普通任务
    const taskQuery = {
        task_status: application.operator.in('option_pending', 'option_transferred', 'option_rollback'),
        task_plan_time: application.operator.gte(currentTime),
        set_warning_time: 'option_yes',
    };

    const tasks = [];
    await application.data
        .object('object_store_task')
        .select(
            '_id',
            'name',
            'description',
            'task_chat',
            'task_handler',
            'task_plan_time',
            'warning_time',
            'option_priority',
            'source_department',
            'task_create_time',
            'deadline_time',
        )
        .where(taskQuery)
        .findStream(record => {
            tasks.push(...record);
        });

    const warningTasks = filterWarningTasks(tasks, currentTime, logger);
    const messageCardSendDataList = await generateMessageCardSendData(warningTasks, logger);

    const client = await newLarkClient({ userId: context.user._id }, logger);

    const limitedSendFeishuMessage = createLimiter(sendFeishuMessage);
    const sendFeishuMessageResults = await Promise.all(messageCardSendDataList.map(data => limitedSendFeishuMessage(data, client)));

    const sendFeishuMessageSuccess = sendFeishuMessageResults.filter(result => result.code === 0);
    const sendFeishuMessageFail = sendFeishuMessageResults.filter(result => result.code !== 0);

    logger.info(`任务定期提醒成功数量: ${sendFeishuMessageSuccess.length}, 失败数量: ${sendFeishuMessageFail.length}`);
    return {
        code: 0,
        message: `任务定期提醒成功数量: ${sendFeishuMessageSuccess.length}, 失败数量: ${sendFeishuMessageFail.length}`,
    };
};

/**
 * 过滤需要提醒的任务
 * @param {Array} tasks 任务列表
 * @param {Number} currentTime 当前时间时间戳
 * @param {Logger} logger 日志记录器
 * @returns {Array} 需要提醒的任务列表
 */
function filterWarningTasks(tasks, currentTime, logger) {
    const warningTasks = [];
    for (const task of tasks) {
        const now = dayjs(currentTime);
        const taskPlanTime = dayjs(task.task_plan_time);
        const warningEndTime = now.add(Number.parseInt(task.warning_time), 'hour');
        const warningStartTime = now.add(Number.parseInt(task.warning_time) - 1, 'hour');

        if (!warningEndTime.isBefore(taskPlanTime) && warningStartTime.isBefore(taskPlanTime)) {
            warningTasks.push(task);
        }
    }
    logger.info(`需要提醒的任务数量: ${warningTasks.length}`);
    return warningTasks;
}

/**
 * 生成需要发送的消息卡片数据
 * @param {Array} tasks 需要提醒的任务列表
 * @param {Logger} logger 日志记录器
 * @returns {Array} 消息卡片数据列表
 */
async function generateMessageCardSendData(tasks, logger) {
    const messageCardSendDataList = [];
    for (const task of tasks) {
        const priority = await faas.function('GetOptionName').invoke({
            table_name: 'object_store_task',
            option_type: 'option_priority',
            option_api: task.option_priority,
        });

        const url = generateTaskUrl(task._id);
        const content = generateMessageContent(task, priority.option_name, url);

        const data = {
            receive_id_type: '',
            msg_type: 'interactive',
            receive_id: '',
            content: JSON.stringify(content),
        };

        if (task.task_chat) {
            const chatId = await getChatId(task.task_chat._id);
            if (chatId) {
                data.receive_id_type = 'chat_id';
                data.receive_id = chatId;
            }
        } else {
            const user = await getUser(task.task_handler._id);
            if (user) {
                const title = `【任务到期提醒】${user._name.find(item => item.language_code === 2052).text}有一条${task.name}门店任务请尽快处理！`;
                content.header.title.content = title;
                data.content = JSON.stringify(content);

                const taskDef = await getTaskDef(task.task_def._id || task.task_def.id);
                if (taskDef.send_channel === 'option_group') {
                    const chatId = await getDepartmentChatId(user._department._id || user._department.id);
                    if (chatId) {
                        data.receive_id_type = 'chat_id';
                        data.receive_id = chatId;
                    } else {
                        logger.warn(`该用户[${user._id}]的部门飞书群不存在`);
                        data.receive_id_type = 'user_id';
                        data.receive_id = user._lark_user_id;
                    }
                } else {
                    data.receive_id_type = 'user_id';
                    data.receive_id = user._lark_user_id;
                }
            }
        }
        messageCardSendDataList.push(data);
    }
    return messageCardSendDataList;
}

/**
 * 生成任务URL
 * @param {String} taskId 任务ID
 * @returns {Object} URL对象
 */
function generateTaskUrl(taskId) {
    return {
        url: `https://et6su6w956.feishuapp.cn/ae/apps/one_store__c/aadgik5q3gyhw?params_var_bcBO3kSg=${taskId}`,
        pc_url: `https://et6su6w956.feishuapp.cn/ae/apps/one_store__c/aadgik5q3gyhw?params_var_bcBO3kSg=${taskId}`,
        android_url: `https://et6su6w956.feishuapp.cn/ae/apps/one_store__c/aadgihlti4uni?params_var_LLsDqf8w=${taskId}`,
        ios_url: `https://et6su6w956.feishuapp.cn/ae/apps/one_store__c/aadgihlti4uni?params_var_LLsDqf8w=${taskId}`,
    };
}

/**
 * 生成消息内容
 * @param {Object} task 任务对象
 * @param {String} priority 任务优先级
 * @param {Object} url URL对象
 * @returns {Object} 消息内容对象
 */
function generateMessageContent(task, priority, url) {
    return {
        config: {
            wide_screen_mode: true,
        },
        elements: [
            {
                tag: 'div',
                text: {
                    content: '任务优先级：' + priority,
                    tag: 'plain_text',
                },
            },
            {
                tag: 'div',
                text: {
                    content: '任务来源：' + task.source_department._name.find(item => item.language_code === 2052).text,
                    tag: 'plain_text',
                },
            },
            {
                tag: 'div',
                text: {
                    content: '任务下发时间：' + dayjs(task.task_create_time).add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
                    tag: 'plain_text',
                },
            },
            {
                tag: 'div',
                text: {
                    content: '距离截至时间还有' + Number.parseFloat(task.deadline_time).toFixed(2) + '小时',
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
                        multi_url: url,
                    },
                ],
            },
        ],
        header: {
            template: 'turquoise',
            title: {
                content: '【任务到期提醒】有一条' + task.name + '门店任务请尽快处理！',
                tag: 'plain_text',
            },
        },
    };
}

/**
 * 获取飞书群ID
 * @param {String} chatId 群组ID
 * @returns {String} 飞书群ID
 */
async function getChatId(chatId) {
    const chat = await application.data.object('object_feishu_chat').select('_id', 'chat_id').where({ _id: chatId }).findOne();
    return chat ? chat.chat_id : null;
}

/**
 * 获取用户信息
 * @param {String} userId 用户ID
 * @returns {Object} 用户对象
 */
async function getUser(userId) {
    return await application.data.object('_user').select('_id', '_department', '_lark_user_id').where({ _id: userId }).findOne();
}

/**
 * 获取任务定义
 * @param {String} taskDefId 任务定义ID
 * @returns {Object} 任务定义对象
 */
async function getTaskDef(taskDefId) {
    return await application.data.object('object_task_def').select('_id', 'send_channel').where({ _id: taskDefId }).findOne();
}

/**
 * 获取部门飞书群ID
 * @param {String} departmentId 部门ID
 * @returns {String} 部门飞书群ID
 */
async function getDepartmentChatId(departmentId) {
    const chat = await application.data.object('object_feishu_chat').select('_id', 'chat_id').where({ department: departmentId }).findOne();
    return chat ? chat.chat_id : null;
}

const sendFeishuMessage = async (messageCardSendData, client) => {
    try {
        let result = await faas.function('MessageCardSend').invoke({ ...messageCardSendData, client });
        return result;
    } catch (error) {
        return { code: -1, message: error.message, result: 'failed' };
    }
};
