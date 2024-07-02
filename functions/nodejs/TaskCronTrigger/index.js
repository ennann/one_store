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
                    datetime_publish: _.and(_.lte(currentTime + timeBuffer),_.gte(currentTime)),
                    // datetime_publish: _.lte(currentTime + timeBuffer), // 5分钟内的任务
                    // datetime_publish: _.gte(currentTime),
                }), // 一次性任务的条件
            ),
        )
        .find();

    logger.info(`查询到的任务定义数量: ${taskDefineRecords.length}`);
    if (taskDefineRecords.length == 200) logger.warn('查询到任务定义数量达到200条，可能有遗漏');

    const calculateTriggerDates = task => {
        const unitMapping = {
            option_day: 'day',
            option_week: 'week',
            option_month: 'month',
            option_quarter: { unit: 'month', factor: 3 },
            option_half_year: { unit: 'month', factor: 6 },
            option_year: 'year',
        };

        const { datetime_start: startTime, datetime_end: endTime, option_time_cycle: cycleType, repetition_rate: repetitionRate } = task;
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
            nextTriggerDate = nextTriggerDate.add(repetitionRate * factor, unit);
        }

        return triggerDates;
    };

    const valuedTaskDefineList = [];

    // 循环所有 taskDefineRecords
    for (const task of taskDefineRecords) {
        if (task.option_method === 'option_once') {
            valuedTaskDefineList.push(task);
            continue;
        }

        if (task.option_method === 'option_cycle') {
            const triggerDates = calculateTriggerDates(task);
            logger.info(`任务定义 ${task.task_number} 的触发日期: ${triggerDates}；周期开始时间: ${dayjs(task.datetime_start).format('YYYY-MM-DD HH:mm:ss')}`);
            if (triggerDates.includes(currentDate)) {
                logger.info(`任务定义 ${task.task_number} 的触发日期: ${currentDate} 在触发日期内`, triggerDates);
                const triggerTime = dayjs(`${currentDate} ${dayjs(task.datetime_start).format('HH:mm:ss')}`).valueOf();

                // 如果 triggerTime 在触发时间范围内，则将任务定义加入到有效任务定义列表中
                if (triggerTime >= triggerRangeStart && triggerTime <= triggerRangeEnd) {
                    valuedTaskDefineList.push(task);
                    logger.info(`任务定义 ${task.task_number} 在触发时间范围内: ${dayjs(task.datetime_start).format('YYYY-MM-DD  HH:mm:ss')}`);
                }
            } else {
                logger.info(`任务定义 ${task.task_number} 不在触发日期内: ${dayjs(task.datetime_start).format('YYYY-MM-DD  HH:mm:ss')}`, triggerDates);
            }
        }
    }
    logger.info(`有效的任务定义数量: ${valuedTaskDefineList.length}`);

    // 创建一个函数，用于调用任务生成函数，最后使用 Promise.all 来并发执行 valuedTaskDefineList 内的任务定义
    const invokeTaskGenerateFunction = async taskDefine => {
        // 调用任务生成函数
        return faas.function('TaskTimedGeneration').invoke({ task_def_record: taskDefine });
    };

    // 这里不使用 Promise.all 来并发执行任务定义，而是使用 for 循环来逐个执行
    const taskGenerationResult = [];
    for (const taskDefine of valuedTaskDefineList) {
        const result = await invokeTaskGenerateFunction(taskDefine);
        taskGenerationResult.push(result);
    }

    const successList = taskGenerationResult.filter(item => item.code === 0);
    const failList = taskGenerationResult.filter(item => item.code !== 0);

    logger.info(`任务触发器函数执行完成, 成功数量: ${successList.length}, 失败数量: ${failList.length}`);

    return {
        message: '任务触发器函数执行成功',
        successList,
        failList,
    };
};
