const { batchOperation,createLimiter, newLarkClient} = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info('开始执行任务批量取消', params);
    const { task_create_monitor } = params;
    const client = await newLarkClient({ userId: context.user._id }, logger);
    // 撤回方法
    const recall = async (message_id) => {
        try {
            const res = await client.im.message.delete({ path: { message_id } });
            // logger.info('飞书平台撤回信息：',res);
            if (res.code !== 0) {
                logger.error(`${message_id} 消息撤回失败`);
                return { code: -1 };
            }
            return res;
        } catch (error) {
            logger.error(`${message_id} 消息撤回失败`, error);
            return { code: -1 };
        }
    };

    // 根据任务批次记录，获取任务列表
    if (!task_create_monitor._id && !task_create_monitor.id) {
        logger.error('不存在任务批次记录');
        return { code: -1, message: '任务批次记录格式错误' };
    }

    const taskRecords = [];
    await application.data
        .object('object_store_task')
        .select('_id','task_message_id')
        .where({ task_monitor: task_create_monitor._id || task_create_monitor.id })
        .findStream(async records => {
            taskRecords.push(...records);
        });

    if (taskRecords.length === 0) {
        return { code: 0, message: '没有待处理任务' };
    }
    logger.info("撤回的任务消息：",taskRecords[0]);

    if (taskRecords.length > 0) {
        const recallFun = createLimiter(recall);
        await Promise.all(taskRecords.map(item => recallFun(item.task_message_id)));
    }

    // 构造批量更新数据的格式
    const updateData = taskRecords.map(record => ({
        _id: record._id,
        task_status: 'option_cancelled',
    }));

    // 批量更新任务状态 todo 判断是删除还是更新
    await batchOperation(logger, 'object_store_task', 'batchUpdate', updateData);
    logger.info(`任务批量取消成功，共取消${taskRecords.length}个任务`);

    return { code: 0, message: '任务批量取消成功' };
};
