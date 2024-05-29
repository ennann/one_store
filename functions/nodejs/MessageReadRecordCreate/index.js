// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    
    if (params.user_ids.length === 0) {
        logger.error('用户ID列表为空，无法创建消息阅读记录');
        return { code: -1, message: '用户ID列表为空，无法创建消息阅读记录' };
    }

    if (!params.message_send_record) {
        return { code: -1, message: '消息发送记录不存在，无法创建消息阅读记录' };
    }

    const { user_ids, message_send_record } = params;

    // 发送群消息时 创建消息阅读记录
    const createMessageReadRecord = async (userId, _id) => {
        try {
            const createData = {
                message_send_record: { _id },
                accept_user: { _id: userId },
                read_status: 'option_unread',
            };
            const res = await application.data.object('object_message_read_record').create(createData);
            return {
                ...res,
                code: 0,
            };
        } catch (error) {
            logger.error(`创建消息阅读记录 ${_id} 失败，对应的 userId 为 ${userId}`, error);
            return { code: -1, message: `创建消息阅读记录 ${_id} 的阅读记录失败，对应的 userId 为 ${userId}` };
        }
    };

    try {
        let messageReadRecordResults = await Promise.all(user_ids.map(userId => createMessageReadRecord(userId, message_send_record._id || message_send_record.id)));

        let successRecords = messageReadRecordResults.filter(record => record.code === 0);
        let failedRecords = messageReadRecordResults.filter(record => record.code !== 0);
        logger.info(`创建消息阅读记录结果共 ${messageReadRecordResults.length} 条，成功 ${successRecords.length} 条，失败 ${failedRecords.length} 条`);
        return {
            total: messageReadRecordResults.length,
            successCount: successRecords.length,
            failedCount: failedRecords.length,
        };
    } catch (error) {
        logger.error(`创建消息阅读记录`, error);
        return { code: -1, message: '创建消息阅读记录失败' };
    }
};
