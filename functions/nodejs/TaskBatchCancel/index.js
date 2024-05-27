const { batchOperation } = require("../utils");


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

  if (!task_create_monitor) {
    logger.error('未传入任务批次记录');
    return { code: -1, message: '未传入任务处理记录' };
  }

  // 根据任务批次记录，获取任务列表

  if (!task_create_monitor._id && !task_create_monitor.id) {
    logger.error('不存在任务批次记录');
    return { code: -1, message: '任务批次记录格式错误' };
  }

  const taskRecords = [];
  await application.data.object('object_store_task')
    .select('task_monitor', 'task_status')
    .where({ task_monitor: task_create_monitor._id || task_create_monitor.id })
    .findStream(async records => {
      taskRecords.push(...records);
    });

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
  logger.info(`任务批量取消成功，共取消${taskRecords.length}个任务`);
  return { code: 0, message: '任务批量取消成功' };

};
