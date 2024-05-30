const dayjs = require('dayjs');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // Response skeleton
    let response = {
        code: 0,
        message: '任务批次数据获取成功',
    };

    // Extract task definition from params
    const { object_task_def } = params;

    // Validate task definition presence
    if (!object_task_def) {
        response.code = -1;
        response.message = '缺少必要参数：任务定义数据';
        return response;
    }

    try {
        // 消息批次总数
        const taskBatchTotal = await application.data
            .object('object_task_create_monitor')
            .select('_id', 'batch_no')
            .where({ task_def: { _id: object_task_def._id } })
            .count();
        const size = taskBatchTotal + 1;

        // 消息定义数据
        let taskDefine = await application.data
            .object('object_task_def')
            .select('_id', 'task_number', 'datetime_start', 'datetime_end', 'option_time_cycle', 'repetition_rate')
            .where({ _id: object_task_def._id })
            .findOne();

        let triggerDates = calculateTriggerDates(taskDefine, logger);

        const newBatchNo = `${size.toString().padStart(6, '0')}`;
        response.batch_no = taskDefine.task_number + '-' + newBatchNo;
        response.batch_progress = size + '/' + triggerDates.length;
    } catch (error) {
        logger.error(`数据库操作失败: ${error}`);
        response.code = -1;
        response.message = '内部服务器错误';
    }

    return response;
};

/**
 * @description 计算任务的触发日期
 * @param {*} task
 * @returns {Array} 触发日期列表
 */
const calculateTriggerDates = (task, logger) => {
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
