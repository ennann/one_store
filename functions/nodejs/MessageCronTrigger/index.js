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
  const currentDate = dayjs().format('YYYY-MM-DD');
  const currentTime = dayjs().valueOf(); // 当前时间
  const timeBuffer = 1000 * 60 * 7; // 5 minutes buffer

  const messageDefineFields = await application.metadata.object("object_chat_message_def").getFields();
  const fieldApiNames = messageDefineFields.map(item => item.apiName);

  // 查询所有的消息定义数据
  const messageDefineRecords = await application.data
    .object('object_chat_message_def')
    .select(fieldApiNames)
    .where(
      _.or(
        _.and({
          option_status: 'option_enable',
          option_method: 'option_cycle',
          datetime_start: _.lte(currentTime),
          datetime_end: _.gte(currentTime),
        }), // 周期消息的条件
        _.and({
          option_status: 'option_enable',
          option_method: 'option_once',
          boolean_public_now: false,
          datetime_publish: _.lte(currentTime), // 5分钟内的消息
          datetime_publish: _.gte(currentTime - timeBuffer),
        }), // 一次性消息的条件
      ),
    )
    .find();
  if (messageDefineRecords.length == 200) logger.warn('查询到的消息定义数量达到200条，可能有遗漏');


  const unitMapping = {
    option_day: 'day',
    option_week: 'week',
    option_month: 'month',
    option_quarter: { unit: 'month', factor: 3 },
    option_half_year: { unit: 'month', factor: 6 },
    option_year: 'year',
  };

  let valuedMessageDefineList = [];

  const calculateTriggerDates = (startDate, endDate, repetitionRate, unit) => {
    const triggerDates = [];
    let nextTriggerDate = startDate;

    while (nextTriggerDate.isBefore(endDate) || nextTriggerDate.isSame(endDate)) {
      triggerDates.push(nextTriggerDate.format('YYYY-MM-DD'));
      nextTriggerDate = nextTriggerDate.add(repetitionRate, unit);
    }

    return triggerDates;
  };

  const isTriggerTime = (currentTime, triggerTime, timeBuffer) => {
    return currentTime >= triggerTime && currentTime <= triggerTime + timeBuffer;
  };


  // 循环所有 messageDefineRecords
  for (const message of messageDefineRecords) {
    if (message.option_method === 'option_once') {
      valuedMessageDefineList.push(message);
      continue;
    }

    if (message.option_method === 'option_cycle') {
      const { datetime_start: startTime, datetime_end: endTime, option_time_cycle: cycleType, repetition_rate: repetitionRate } = message;
      const startDate = dayjs(startTime);
      const endDate = dayjs(endTime);
      let unit,
        factor = 1;

      if (unitMapping[cycleType]) {
        if (typeof unitMapping[cycleType] === 'object') {
          unit = unitMapping[cycleType].unit;
          factor = unitMapping[cycleType].factor;
        } else {
          unit = unitMapping[cycleType];
        }
      } else {
        logger.warn(`未知的周期类型: ${cycleType}`);
        continue;
      }

      const triggerDates = calculateTriggerDates(startDate, endDate, repetitionRate * factor, unit);


      if (triggerDates.includes(currentDate)) {
        const triggerTime = dayjs(`${currentDate} ${startDate.format('HH:mm:ss')}`).valueOf();

        if (isTriggerTime(currentTime, triggerTime, timeBuffer)) {
          valuedMessageDefineList.push(message);
        }
      }
    }
  }


  // return valuedMessageDefineList;

  // 创建一个函数，用于调用消息生成函数，最后使用 Promise.all 来并发执行 valuedMessageDefineList 内的消息定义
  const invokeMessageBatchSendFunction = message_def => {
    // 直接返回 promise
    return faas.function('MessageBatchSend').invoke({ record: message_def });
  };

  // 并发执行消息生成函数
  const messageGenerationResult = await Promise.all(valuedMessageDefineList.map(invokeMessageBatchSendFunction));

  const successList = messageGenerationResult.filter(item => item.code === 0);
  const failList = messageGenerationResult.filter(item => item.code !== 0);

  return {
    message: '消息触发器函数执行成功',
    successList,
    failList,
  };
};
