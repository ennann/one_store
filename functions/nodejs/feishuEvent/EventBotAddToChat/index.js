const { newLarkClient } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info(`机器人进群事件发生，函数开始执行`);

    const client = await newLarkClient({ userId: context?.user?._id }, logger); // 创建 Lark 客户端

    const chat_id = params?.event?.event?.chat_id;
    const chat_name = params?.event?.event?.name;

    // 根据 chat_id 查找是否有群记录，如果
    let group_record = await application.data.object('object_feishu_chat').select('_id').where({ chat_id: chat_id }).findOne();

    if (!group_record) {
        // 如果没有群记录，则创建一个
        group_record = await application.data.object('object_feishu_chat').create({
            chat_id: chat_id,
            chat_name: chat_name,
            is_store_chat: false,
        });
    }
    logger.info(group_record);

    const button_url = await generateCardButtonUrl(context, chat_id, group_record._id);

    // 消息卡片的发送必须是 stringify 之后的数据
    const card_message =
        '{"config":{"wide_screen_mode":true},"elements":[{"tag":"markdown","content":"为了更好地服务大家，请群主请将一店一群机器人设为群管理员。"},{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"点击授权"},"type":"primary","multi_url":{"url":"baidu.com","pc_url":"","android_url":"","ios_url":""}}]}],"header":{"template":"red","title":{"content":"🤖 请群主为一店一群机器人授权","tag":"plain_text"}}}';
    logger.info('获取到的卡片消息', card_message);

    let message = JSON.parse(card_message);
    message.elements[1].actions[0].multi_url.url = button_url;
    message = JSON.stringify(message);

    logger.info('chat_id:', chat_id);
    logger.info('button_url:', button_url);
    logger.info('message:', JSON.stringify(message, null, 4));

    let response = await client.im.message.create({
        params: {
            receive_id_type: 'chat_id',
        },
        data: {
            receive_id: chat_id,
            msg_type: 'interactive',
            content: message,
        },
    });
    logger.info(response);

    if (response?.code !== 0) {
        logger.info(response);
        logger.error('发送消息失败');
        return {
            code: 400,
            msg: '发送消息失败',
        };
    }
    // 将信息存储到redis中标记  key -> 群号   value -> message_id
    await baas.redis.setex(response.data.chat_id, 24 * 60 * 60 * 30, response.data.message_id);
};

/**
 * @description 生成机器人进群消息卡片按钮的 URL
 * @param {} context
 * @param {*} chat_id
 * @returns
 */
async function generateCardButtonUrl(context, chat_id, group_id) {
    const SCOPE = 'im:chat';
    const STATE = `setgroupadmin_user`;
    const { appId: APPID } = await application.integration.getDefaultTenantAccessToken();
    const { name: tenantDomain, namespace } = context.tenant;

    const BASE_URL =`https%3A%2F%2F${tenantDomain}.feishuapp.cn%2Fae%2Fapps%2F${namespace}%2Faadgdtfskbqhi`;

    const REDIRECT_URI = `${BASE_URL}%3Fparams_var_RDE3AgWC%3D${chat_id}%26params_var_QrP6EhWe%3D${group_id}`;
    // %3Fparams_var_RDE3AgWC%3Doc_34e76ae070db2034746777a762f86439%26params_var_QrP6EhWe%3D1796560404246715

    return `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APPID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&state=${STATE}`;
}
