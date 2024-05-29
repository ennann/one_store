const { chunkArray } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info('【异步调用】创建消息发送记录函数开始执行');
    logger.info('仅打印第一个元素检查数据', params.message_send_result[0]);

    if (!params.message_define || !params.message_send_batch || !params.message_send_result) {
        return { code: -1, message: '缺少参数' };
    }

    const { message_define, message_send_batch, message_send_result } = params;

    // 获取飞书群成员
    const getChatMembers = async _id => {
        try {
            const chatMemberIds = [];
            await application.data
                .object('object_chat_member')
                .where({ store_chat: { _id } })
                .select('_id', 'chat_member')
                .findStream(records => {
                    const ids = records.map(i => i.chat_member?._id);
                    chatMemberIds.push(...ids);
                });
            return chatMemberIds;
        } catch (error) {
            logger.error(`获取飞书群成员 ${_id} 失败`, error);
            return [];
        }
    };

    // 获取群信息
    const getChatInfo = async data => {
        try {
            const chat_record = await application.data
                .object('object_feishu_chat')
                .where({
                    chat_id: data.chat_id,
                    chat_status: 'option_02',
                })
                .select('_id', 'chat_owner', 'chat_managers', 'department')
                .findOne();

            const chatMemberIds = await getChatMembers(chat_record._id);

            const allMemberIds = Array.from(new Set([...(chat_record.chat_managers?.map(i => i._id) || []), ...chatMemberIds, chat_record.chat_owner?._id].filter(Boolean)));

            return {
                department: { _id: chat_record.department?._id },
                message_chat: { _id: chat_record._id },
                unread_count: allMemberIds.length,
                allMemberIds,
            };
        } catch (error) {
            logger.error(`获取飞书群 ${data.chat_id} 信息失败`, error);
        }
    };

    // 获取人员信息
    const getUserInfo = async _lark_user_id => {
        try {
            const user_record = await application.data.object('_user').where({ _lark_user_id }).select('_id', '_department').findOne();
            return {
                unread_count: 1,
                accept_user: [{ _id: user_record._id }],
                department: { _id: user_record._department._id },
            };
        } catch (error) {
            logger.error(`获取人员 ${_lark_user_id} 信息失败`, error);
            return { unread_count: 0 };
        }
    };

    // 创建【消息发送记录】对象下的数据
    const createMessageSendRecord = async record => {
        try {
            let createData = {
                message_send: { _id: message_define._id },
                message_batch: { _id: message_send_batch._id },
                option_send_channel: message_define.send_channel,
                message_id: record.data.message_id,
                read_status: 'option_unread',
                read_count: 0,
                result: record.code === 0 ? 'option_success' : 'option_failed',
            };

            let user_ids = [];
            // 当消息定义发送渠道为群组时，获取群组信息
            if (message_define.send_channel === 'option_group') {
                const { allMemberIds, ...rest } = await getChatInfo(record.data);
                user_ids = allMemberIds;
                createData = { ...createData, ...rest };
            }
            // 当消息定义发送渠道为个人时，获取个人信息
            if (message_define.send_channel === 'option_user') {
                const userInfo = await getUserInfo(record.receive_id);
                createData = { ...createData, ...userInfo };
            }

            let messageReadRecordResults;
            let message_send_record;
            // 创建消息发送记录
            try {
                message_send_record = await application.data.object('object_message_record').create(createData);
            } catch (error) {
                logger.info(`创建消息发送记录 ${record.data.message_id} 失败`, createData, error);
                return { code: -1, message: `创建消息发送记录 ${record.data.message_id} 失败`, createData, error };
            }

            // 如果发送的对象是群组，需要对群组内的成员创建消息阅读记录，否则单个人员的不需要创建
            if (message_define.send_channel === 'option_group') {
                // 创建消息发送阅读记录
                messageReadRecordResults = await faas.function('MessageReadRecordCreate').invoke({
                    user_ids,
                    message_send_record,
                });
                logger.info('创建消息阅读记录结果', messageReadRecordResults);
            }
            return { code: 0, message_send_record, messageReadRecordResults };
        } catch (error) {
            logger.error(`创建消息发送记录 ${record.data.message_id} 失败`, error);
            return { code: -1, message: `创建消息发送记录 ${record.data.message_id} 失败` };
        }
    };

    try {
        let createMessageRecordResult = await Promise.all(message_send_result.map(item => createMessageSendRecord(item)));
        logger.info('创建消息发送记录成功', createMessageRecordResult);

        let successMessageRecord = createMessageRecordResult.filter(item => item.code === 0);
        let failedMessageRecord = createMessageRecordResult.filter(item => item.code !== 0);
        logger.info(`创建消息发送记录总数：${createMessageRecordResult.length}，成功：${successMessageRecord.length}，失败：${failedMessageRecord.length}`);
        return { code: 0, message: '创建消息发送记录成功' };
    } catch (error) {
        logger.error('创建消息发送记录失败', error);
        return { code: -1, message: '创建消息发送记录失败' };
    }
};
