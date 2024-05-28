const dayjs = require('dayjs');
const { createLimiter } = require('../utils');

module.exports = async function (params, context, logger) {
    logger.info(`批量发送消息 函数开始执行`, params);

    const { record } = params;
    const KEY = record._id;
    const redisValue = await baas.redis.get(KEY);

    if (redisValue) {
        throw new Error('已存在执行中发送消息任务');
    }

    let sendIds = [];
    let errorNum = 0;
    const MAX_ERROR_NUM = 5;

    const createSendRecord = async () => {
        try {
            const batch_no = await faas.function('MessageGenerateBatchNumber').invoke({ record: record });
            const createData = {
                batch_no,
                option_status: 'option_sending',
                message_send_def: { _id: record._id },
                send_start_datetime: dayjs().valueOf(),
            };
            const res = await application.data.object('object_message_send').create(createData);
            logger.info('创建消息发送批次成功', res);
            return res._id;
        } catch (error) {
            logger.error('创建消息发送批次失败', error);
            throw new Error('创建消息发送批次失败', error);
        }
    };

    const messageContent = await faas.function('MessageContentGenerator').invoke({ record });

    const sendMessage = async receive_id => {
        const paramsData = { ...messageContent, receive_id };
        logger.info({ paramsData });
        try {
            const res = await faas.function('MessageCardSend').invoke({ ...paramsData });
            errorNum = 0;
            return { ...res, receive_id };
        } catch (error) {
            if (errorNum >= MAX_ERROR_NUM) {
                errorNum = 0;
                throw new Error(`发送消息失败超过最大次数${MAX_ERROR_NUM} - `, paramsData);
            }
            logger.info(error);
            errorNum += 1;
            sendMessage(receive_id);
        }
    };

    try {
        if (!record.send_channel) {
            throw new Error('没有选择飞书发送渠道');
        }

        if (record.send_channel === 'option_group') {
            if (!record.chat_rule) {
                throw new Error('缺少群组筛选规则');
            }
            const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: record.chat_rule });
            logger.info({ chatRecordList });
            sendIds = chatRecordList.map(i => i.chat_id);
            logger.info({ sendIds });
        }

        if (record.send_channel === 'option_user') {
            if (!record.user_rule) {
                throw new Error('缺少人员筛选规则');
            }
            const userList = await faas.function('DeployMemberRange').invoke({ user_rule: record.user_rule });
            sendIds = userList.map(i => i.user_id);
        }

        if (sendIds.length > 0) {
            await baas.redis.set(KEY, new Date().getTime());
            const recordId = await createSendRecord();
            const limitSendMessage = createLimiter(sendMessage);
            logger.info({ sendIds });
            const sendMessageResult = await Promise.all(sendIds.map(id => limitSendMessage(id)));
            const successRecords = sendMessageResult.filter(result => result.code === 0);
            const failRecords = sendMessageResult.filter(result => result.code !== 0);
            logger.info(`消息总数：${sendMessageResult.length}`);
            logger.info(`成功数量：${successRecords.length}`);
            logger.info(`失败数量：${failRecords.length}`);

            let option_status;
            if (successRecords.length === sendMessageResult.length) {
                option_status = 'option_all_success';
            } else if (failRecords.length === sendMessageResult.length) {
                option_status = 'option_fail';
            } else {
                option_status = 'option_part_success';
            }

            if (recordId) {
                try {
                    const updateData = {
                        _id: recordId,
                        option_status,
                        send_count: sendIds.length,
                        success_count: successRecords.length,
                        fail_count: failRecords.length,
                        send_end_datetime: dayjs().valueOf(),
                        msg_type: messageContent.msg_type,
                        message_content: messageContent.content,
                    };
                    logger.info({ updateData });
                    await application.data.object('object_message_send').update(updateData);
                    const res = await baas.tasks.createAsyncTask('MessageSendRecordCreate', {
                        message_send_result: sendMessageResult,
                        message_send_batch: { _id: recordId },
                        message_define: record,
                    });
                    logger.info('更新消息发送批次成功, 执行创建消息发送记录异步任务', { res });
                } catch (error) {
                    throw new Error('创建消息发送记录失败', error);
                }
                return { code: 0, message: '批量发送消息成功' };
            }
        }
    } catch (error) {
        logger.error('批量发送消息失败', error);
        throw error;
    } finally {
        await baas.redis.set(KEY, null);
    }
};
