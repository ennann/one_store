const dayjs = require('dayjs');
const { sleep } = require('../../utils');
const _ = application.operator;
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info(`消息定时触发函数开始执行`, params);

    const currentDate = dayjs().format('YYYY-MM-DD');
    const currentTime = dayjs().startOf('minute').valueOf(); // 当前时间的分钟开始时间
    const timeBuffer = 1000 * 60 * 5; // 5分钟的缓冲时间

    // 根据当前时间和缓冲时间计算触发时间范围
    const triggerRangeStart = currentTime - timeBuffer;
    const triggerRangeEnd = currentTime + timeBuffer;

    logger.info(`当前时间: ${currentTime}, ${dayjs(currentTime).format('YYYY-MM-DD HH:mm:ss')}, 当前日期: ${currentDate}`);
    logger.info(`减去后的时间: ${currentTime - timeBuffer}, ${dayjs(currentTime - timeBuffer).format('YYYY-MM-DD HH:mm:ss')}`);

    const messageDefineFields = await application.metadata.object('object_chat_message_def').getFields();
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
                    datetime_start: _.lte(currentTime + timeBuffer),
                    datetime_end: _.gte(currentTime),
                }), // 周期消息的条件
                _.and({
                    option_status: 'option_enable',
                    option_method: 'option_once',
                    boolean_public_now: false,
                    datetime_publish: _.and(_.lte(currentTime + timeBuffer),_.gte(currentTime))
                    // datetime_publish: _.lte(currentTime + timeBuffer), // 5分钟内的消息
                    // datetime_publish: _.gte(currentTime),
                }), // 一次性消息的条件
            ),
        )
        .find();

    logger.info(
        `查询到的消息定义数量: ${messageDefineRecords.length}`,
        messageDefineRecords.map(item => item.number),
    );

    if (messageDefineRecords.length === 200) logger.warn('查询到的消息定义数量达到200条，可能有遗漏');

    const calculateTriggerDates = message => {
        const unitMapping = {
            option_day: 'day',
            option_week: 'week',
            option_month: 'month',
            option_quarter: { unit: 'month', factor: 3 },
            option_half_year: { unit: 'month', factor: 6 },
            option_year: 'year',
        };

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
            return [];
        }

        const triggerDates = [];
        let nextTriggerDate = startDate;

        while (nextTriggerDate.isBefore(endDate) || nextTriggerDate.isSame(endDate)) {
            triggerDates.push(nextTriggerDate.format('YYYY-MM-DD'));
            if (cycleType === 'option_month') {
                // 考虑每个月的最后一天
                const daysInMonth = nextTriggerDate.add(repetitionRate * factor, unit).daysInMonth();
                nextTriggerDate = nextTriggerDate.date() > daysInMonth
                    ? nextTriggerDate.add(repetitionRate * factor, unit).date(daysInMonth)
                    : nextTriggerDate.add(repetitionRate * factor, unit);
            } else {
                // 对于其他周期类型，直接增加
                nextTriggerDate = nextTriggerDate.add(repetitionRate * factor, unit);
            }
        }

        return triggerDates;
    };

    let valuedMessageDefineList = [];

    // 循环所有 messageDefineRecords
    for (const message of messageDefineRecords) {
        if (message.option_method === 'option_once') {
            valuedMessageDefineList.push(message);
            continue;
        }

        if (message.option_method === 'option_cycle') {
            const triggerDates = calculateTriggerDates(message);
            logger.info(message.number, `消息定义的触发日期: ${triggerDates}`, '周期开始时间', dayjs(message.datetime_start).format('YYYY-MM-DD HH:mm:ss'));

            if (triggerDates.includes(currentDate)) {
                logger.info(`消息定义 ${message.number} 的触发日期: ${currentDate} 在触发日期内`, triggerDates);
                const triggerTime = dayjs(`${currentDate} ${dayjs(message.datetime_start).format('HH:mm')}`).valueOf();

                //如果 triggerTime 在 triggerRangeStart 和 triggerRangeEnd 之间，则触发
                if (triggerTime >= triggerRangeStart && triggerTime <= triggerRangeEnd) {
                    valuedMessageDefineList.push(message);
                    logger.info(`消息定义 ${message.number} 在触发时间内`, triggerTime, triggerRangeStart, triggerRangeEnd);
                }
            } else {
                logger.info(`消息定义 ${message.number} 不在触发日期内`, dayjs(message.datetime_start).format('YYYY-MM-DD HH:mm:ss'), triggerDates);
            }
        }
    }
    logger.info(
        `有效的消息定义数量: ${valuedMessageDefineList.length}`,
        valuedMessageDefineList.map(item => item.number),
    );

    // 创建一个函数，用于调用消息生成函数，最后使用 Promise.all 来并发执行 valuedMessageDefineList 内的消息定义
    const invokeMessageBatchSendFunction = async messageDef => {
        // 根据消息定义的执行时间，设置延迟多少秒后执行
        const time = messageDef.datetime_publish - dayjs().valueOf();
        await sleep(time);
        return faas.function('MessageBatchSend').invoke({ record: messageDef });
    };

    let messageGenerationResult = [];
    messageGenerationResult = await Promise.all(valuedMessageDefineList.map(messageDef => invokeMessageBatchSendFunction(messageDef)));

    logger.info(`消息触发器函数执行完成, 结果数量: ${messageGenerationResult.length}`, messageGenerationResult);

    const successList = messageGenerationResult.filter(item => item?.code === 0);
    const failList = messageGenerationResult.filter(item => item?.code !== 0);

    logger.info(`消息定时触发函数执行完成, 成功数量: ${successList.length}, 失败数量: ${failList.length}`);

    return {
        message: '消息触发器函数执行成功',
        successList,
        failList,
    };
};
