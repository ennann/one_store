// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const dayjs = require('dayjs');
const { createLimiter } = require('../utils');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    if (!params.record) {
        throw new Error('请传入消息发送批次');
    }

    const { record } = params;
    const DB = application.data.object;
    const BATCH_OBJECT = 'object_message_send';
    const RECORD_OBJECT = 'object_message_record';

    // 获取用户ID
    const getUserIds = async users => {
        try {
            const userRecords = await DB('_user')
                .where({
                    _id: application.operator.hasAnyOf(users.map(i => i._id)),
                })
                .select('_lark_user_id')
                .find();
            return userRecords.map(i => i._lark_user_id);
        } catch (error) {
            throw new Error('获取用户信息失败', error);
        }
    };

    // 获取飞书群成员
    const getChatMembers = async _id => {
        try {
            const chatMemberIds = [];
            await DB('object_chat_member')
                .where({ store_chat: { _id } })
                .select('_id', 'chat_member')
                .findStream(records => {
                    const ids = records.map(i => i.chat_member._id);
                    chatMemberIds.push(...ids);
                });
            return chatMemberIds;
        } catch (error) {
            logger.error(`获取飞书群 ${_id} 成员失败`, error);
            throw new Error(`获取飞书群 ${_id} 成员失败`, error);
        }
    };

    // 获取群信息
    const getChatInfo = async chat => {
        try {
            const chat_record = await DB('object_feishu_chat').where({ _id: chat._id }).select('_id', 'chat_owner', 'chat_managers', 'chat_id').findOne();
            const chatMemberIds = await getChatMembers(chat_record._id);
            const allMemberIds = Array.from(
                new Set([...(chat_record.chat_managers.length > 0 ? chat_record.chat_managers.map(i => i._id) : []), ...chatMemberIds, chat_record.chat_owner._id]),
            );
            return {
                chat_ids: [chat_record.chat_id],
                allMemberIds,
            };
        } catch (error) {
            logger.error(`获取飞书群 ${data.chat_id} 信息失败`, error);
        }
    };

    // 获取批次数据
    const getBatchData = async () => {
        try {
            const data = await DB(BATCH_OBJECT).where({ _id: record._id }).select('_id', 'message_content', 'msg_type', 'success_count').findOne();
            return data;
        } catch (error) {
            throw new Error('获取消息发送批次失败', error);
        }
    };

    // 获取关联批次的消息发送记录
    const getSendRecords = async () => {
        try {
            const sendRecords = [];
            await DB(RECORD_OBJECT)
                .where({
                    message_batch: { _id: record._id },
                    result: 'option_failed',
                })
                .select('_id', 'option_send_channel', 'message_chat', 'accept_user')
                .findStream(records => sendRecords.push(...records));
            return sendRecords;
        } catch (error) {
            throw new Error('获取关联批次的消息发送记录失败', error);
        }
    };

    // 发送消息
    const sendMessage = async ({ _id, option_send_channel, message_chat, accept_user, content, msg_type }) => {
        const receive_id_type = option_send_channel === 'option_group' ? 'chat_id' : 'user_id';
        const msgInfo = { content, msg_type, receive_id_type };
        let ids = [];
        let chatUsers = [];
        if (option_send_channel === 'option_user') {
            ids = await getUserIds(accept_user);
        }
        if (option_send_channel === 'option_group') {
            const { chat_ids, allMemberIds: user_ids } = await getChatInfo(message_chat);
            ids = chat_ids;
            chatUsers = user_ids;
            const task = await baas.tasks.createAsyncTask('MessageReadRecordCreate', {
                user_ids,
                message_send_record: { _id },
            });
        }

        try {
            const funList = ids.map(receive_id => faas.function('MessageCardSend').invoke({ ...msgInfo, receive_id }));
            const result = await Promise.all(funList);
            return result.map(item => ({
                ...item,
                _id,
                unread_count: option_send_channel === 'option_user' ? ids.length : chatUsers.length,
            }));
        } catch (error) {
            logger.error('发送消息失败', error);
            return { code: -1 };
        }
    };

    try {
        // 消息发送记录
        const records = await getSendRecords();
        if (records.length > 0) {
            // 消息批次数据
            const batchData = await getBatchData();
            const msgInfo = {
                content: batchData.message_content,
                msg_type: batchData.msg_type,
            };

            // 更新批次发送状态为重试中 option_retry
            await DB(BATCH_OBJECT).update({
                _id: batchData._id,
                option_status: 'option_retry',
                send_start_datetime: dayjs().valueOf(),
            });

            // 限流器
            const limitSendMessage = createLimiter(sendMessage);
            const res = await Promise.all(records.map(item => limitSendMessage({ ...item, ...msgInfo })));
            const sendMessageResult = res.flat();
            const successRecords = sendMessageResult.filter(i => i.code === 0);
            const failRecords = sendMessageResult.filter(i => i.code !== 0);

            let updateData = {};
            if (sendMessageResult.every(i => i.code === 0)) {
                // 重试全部成功
                updateData = {
                    fail_count: 0,
                    option_status: 'option_all_success',
                    success_count: batchData.success_count + sendMessageResult.length,
                };
            } else {
                // 部分成功
                updateData = {
                    fail_count: failRecords.length,
                    option_status: 'option_part_success',
                    success_count: batchData.success_count + successRecords.length,
                };
            }

            // 更新批次数据
            await DB(BATCH_OBJECT).update({
                ...updateData,
                _id: batchData._id,
                send_end_datetime: dayjs().valueOf(),
            });

            // 更新消息记录
            const updateRecordData = successRecords.map(item =>
                DB(RECORD_OBJECT).update({
                    _id: item._id,
                    result: 'option_success',
                    read_status: 'option_unread',
                    unread_count: item.unread_count,
                }),
            );
            await Promise.all(updateRecordData);
        } else {
            throw new Error('批次中失败的消息发送记录为空');
        }
    } catch (error) {
        logger.error('发送消息重试失败', error);
        throw new Error('发送消息重试失败', error);
    }
};
