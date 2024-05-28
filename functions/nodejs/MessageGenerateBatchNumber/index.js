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
    const { record } = params;

    if (!record) {
        logger.error('查询消息定义时，传入的消息定义参数不能为空');
        return { code: -1, message: '查询消息定义时，传入的消息定义参数不能为空' };
    }

    // 根据 消息定义记录 生成当前的批次号
    let currentDateStart = dayjs().startOf('day').valueOf();
    let currentDateEnd = dayjs().endOf('day').valueOf();
    let query = {
        message_send_def: { _id: record._id },
        send_start_datetime: _.gte(currentDateStart),
        send_start_datetime: _.lte(currentDateEnd),
    };

    const currentDateRecord = await application.data.object('object_message_send').select('_id', 'batch_no').where(query).findOne();

    if (currentDateRecord) {
        return { code: 0, message: '当天已生成过批次号', batch_no: currentDateRecord.batch_no };
    } else {
        try {
            const records = await application.data.object('object_message_send').select('_id', 'batch_no').where({ message_send_def: record._id }).find();
            const data = await application.data.object('object_chat_message_def').select('_id', 'number').where({ _id: record._id }).findOne();
            const newBatchNo = `${(records.length + 1).toString().padStart(6, '0')}`;
            const batch_no = data.number + '-' + newBatchNo;
            return { code: 0, message: '生成批次号成功', batch_no: batch_no };
        } catch (error) {
            logger.error("创建批次号失败，原因：", error);
            return { code: -1, message: '生成批次号失败' };
        }
    }
};
