// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const {newLarkClient} = require('../utils');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    await baas.redis.setex("appToken", 5, '');
    return

    // const client = await newLarkClient({userId: context?.user?._id}, logger); // 创建 Lark 客户端

    // const oldDepStore = await application.data
    //     .object('object_store')
    //     .select('_id')
    //     .where({ store_department: 1800293136277737 })
    //     .findOne();


    const oldDepAllStore111 = await application.data
        .object('object_store_staff')
        .select('_id', 'store_staff_department', 'store_staff')
        .where({
            store_staff: 1798281746550820,
            // store: oldDepStore._id,
        }).find();

    logger.info('门店成员返回测试：', oldDepAllStore111);

return
    const test001 = await application.data.object('object_store_staff').select('_id','store_staff','store_staff_department').where({_id: '1800293549344772'}).find();
    logger.info('门店成员返回', test001);
    return

    const groupMemberRes = await application.data.
    object('object_chat_member')
        .select('chat_member')
        .where({ store_chat: {_id:1798370831960076}}).find();
    logger.info('显示门店返回', groupMemberRes);
    return

    const newStore = await application.data.object('object_store').select('_id').where({store_department: '1799628109794473'}).find();

    logger.info('显示门店返回', newStore);
    return

    const oldDepAllStore = await application.data
        .object('object_store_staff')
        .select('_id')
        .where({
            store_staff: 1799558631371860,
            store_staff_department: 1798306972572779
        })
        .find();
    logger.info(oldDepAllStore)

    let idArray = oldDepAllStore.map(item => item._id); // 提取每个对象的 _id 属性值，生成新的数组

    console.log(idArray); // 输出新生成的数组包含的 _id 值

    await application.data.object("object_store_staff").batchDelete(idArray);

// logger.info(filteredCollection)

    return

    // 日志功能
    // logger.info(`${new Date()} 函数开始执行`);
//   const redisValue = await baas.redis.setex("2024-05-22",24*60*60,0);

//  const flag =  await baas.redis.get("2024-05-22")
//  logger.info("测试数据：",flag)
// await baas.redis.setex(context?.user?._id,20*90,'om_3e1871c25feeac901ebd106d2b6545f3')


// 获取飞书群详细信息
    const chatRes = await client.im.chat.get({
            path: {
                chat_id: "oc_c547588d2bc948afb0a4b5a01a09179e",
            },
            params: {
                user_id_type: 'user_id',
            },
        },
    );
    const larkChatOwnerId = chatRes?.data?.owner_id;

    return


    const messageId = await baas.redis.get('oc_34198632aca8444001d4c8216286e313');


    const card_messageReq =
        '{"config":{"wide_screen_mode":true},"elements":[{"tag":"markdown","content":"为了更好地服务大家，请将一店一群机器人设为群管理员。"},{"tag":"action","actions":[{"tag":"button","disabled":true,"text":{"tag":"plain_text","content":"点击授权"},"type":"primary","multi_url":{"url":"baidu.com","pc_url":"","android_url":"","ios_url":""}}]}],"header":{"template":"red","title":{"content":"🤖 一店一群机器人授权","tag":"plain_text"}}}';
    let messageReq = JSON.parse(card_messageReq);

// 更新飞书的卡片消息
    await client.im.message.patch({
            path: {
                message_id: messageId,
            },
            data: {
                content: card_messageReq,
            },
        },
    ).then(res => {
        console.log(res);
    });

    const apaas_dep_records = [];

    await application.data
        .object("object_chat_member")
        .select(["_id", "store_chat", "chat_member"])
        // .where({_superior: application.operator.contain(1799627808659514) })
        .findStream(records => {
            apaas_dep_records.push(...records);
        });


    const messageDefineFields = await application.metadata.object("object_chat_message_def").getFields();
    const fieldApiNames = messageDefineFields.map(item => item.apiName);

    const a = await application.data
        .object('object_chat_message_def')
        .select(fieldApiNames).findStream(records => {
            apaas_dep_records.push(...records);
        });


// 获取所有部门信息
    await application.data
        .object("_department")
        .select(["_id", "_name", "_superior"])
        // .where({_superior: application.operator.contain(1799627808659514) })
        .findStream(records => {
            apaas_dep_records.push(...records);
        });

    let isLeafNode = true;
    for (const dep of apaas_dep_records) {
        if (dep._superior && "1799627902131225" == dep._superior._id) {
            isLeafNode = false;
        }
    }


    logger.info(isLeafNode);


    return

    const feishu_pins = await application.data.object('object_chat_pin').select('pin_name', 'pin_url', 'chat_rule', '_id', 'all_chats').find();
    logger.info("测试数据：", feishu_pins)

    const feishu_chat_menu_catalogs = await application.data.object('object_chat_menu_catalog').select('name', 'description', 'chat_rule', '_id').where({
        'all_chats': "option_yes"
    }).find();
    logger.info("测试数据：", feishu_chat_menu_catalogs)
    return
    // 在这里补充业务代码

}
