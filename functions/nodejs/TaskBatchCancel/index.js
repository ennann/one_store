const { batchOperation } = require("../utils");


/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date()} 任务批量取消函数开始执行`);

    // 在这里补充业务代码

    const { task_create_monitor } = params;

    if (!task_create_monitor) {
        logger.error('未传入任务批次记录');
        return { code: -1, message: '未传入任务处理记录' };
    }

    // 根据任务批次记录，获取任务列表

    const taskRecords = [];
    await application.data.object('object_store_task')
        .select('task_monitor', 'task_status')
        .where({ task_monitor: task_create_monitor, task_status: "option_pending" })
        .findStream(async records => {
            taskRecords.push(...records);
        });
    
    logger.info(`获取的待处理任务总数为：${taskRecords.length}`);

    if (taskRecords.length === 0) {
        return { code: 0, message: '没有待处理任务' };
    }

    // 构造批量更新数据的格式
    const updateData = taskRecords.map(record => ({
        _id: record._id,
        task_status: 'option_cancelled',
    }));

    // 批量更新任务状态
    await batchOperation(logger, 'object_task_create_monitor', 'batchUpdate', updateData);

    return { code: 0, message: '任务批量取消成功' };

};
