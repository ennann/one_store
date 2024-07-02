const dayjs = require('dayjs');
const _ = application.operator;

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能

  logger.info('任务触发器函数开始执行');

  const currentDate = dayjs().format('YYYY-MM-DD');
  const currentTime = dayjs().startOf('minute').valueOf(); // 当前时间的分钟开始时间
  const timeBuffer = 1000 * 60 * 5; // 5 minutes buffer

  // 根据当前时间和缓冲时间计算触发时间范围
  const triggerRangeStart = currentTime - timeBuffer;
  const triggerRangeEnd = currentTime + timeBuffer;

  logger.info(`当前时间: ${currentTime}, ${dayjs(currentTime).format('YYYY-MM-DD HH:mm:ss')}, 当前日期: ${currentDate}`);
  logger.info(`减去后的时间: ${currentTime - timeBuffer}, ${dayjs(currentTime - timeBuffer).format('YYYY-MM-DD HH:mm:ss')}`);

  const taskDefineFields = await application.metadata.object('object_task_def').getFields();
  const fieldApiNames = taskDefineFields.map(item => item.apiName);

  // 查询所有的任务定义数据
  const taskDefineRecords = await application.data
      .object('object_task_def')
      .select(fieldApiNames)
      .where(
          _.or(
              _.and({
                  option_status: 'option_enable',
                  option_method: 'option_cycle',
                  datetime_start: _.lte(currentTime + timeBuffer),
                  datetime_end: _.gte(currentTime),
              }), // 周期任务的条件
              _.and({
                  option_status: 'option_enable',
                  option_method: 'option_once',
                  boolean_public_now: false,
                  // datetime_publish: _.and(_.lte(currentTime + timeBuffer),_.gte(currentTime)),
                  datetime_publish: _.lte(currentTime + timeBuffer), // 5分钟内的任务
                  datetime_publish: _.gte(currentTime),
              }), // 一次性任务的条件
          ),
      )
      .find();

      logger.info("返回的信息条数：",taskDefineRecords.length,"数据：",taskDefineRecords)

}
