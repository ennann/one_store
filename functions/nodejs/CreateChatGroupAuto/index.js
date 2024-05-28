const { newLarkClient, batchOperation } = require('../utils');
const { convertRecordsToGroupMenu } = require('../GroupMenuUtils/groupMenuConstructor');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const { feishu_chat } = params;
    const feishu_chat_open_id = feishu_chat.chat_id;
    let feishuChatId = feishu_chat._id;

    const client = await newLarkClient({ userId: context.user._id }, logger);

    // 功能一
    // 获取群机器人
    const feishu_bots = await application.data.object('object_chat_bot').select('chat_rule', 'bot_app_id', '_id').find();
    // 循环所有群机器人，将符合规则的机器人加入到群聊中
    for (const feishuBot of feishu_bots) {
        const bot_app_id = feishuBot.bot_app_id;
        const feishuBotId = feishuBot._id;
        if (feishuBot.chat_rule == null) {
            continue;
        }

        // 将机器人拉入群聊
        try {
            const response = await client.im.chatMembers.create({
                path: { chat_id: feishu_chat_open_id },
                params: {
                    member_id_type: 'app_id',
                    succeed_type: 0,
                },
                data: {
                    id_list: [bot_app_id],
                },
            });

            if (response.code !== 0) {
                logger.error(`机器人 ${feishuBot_bot_app_id} 加入群聊 ${feishu_chat_open_id} 失败，错误信息：${response.msg}`);
            } else {
                //存储aPaaS数据
                const data = {
                    union_id: `${bot_app_id}-${feishu_chat_open_id}`,
                    bot: { _id: feishuBotId },
                    chat: { _id: feishuChatId },
                };
                try {
                    await application.data.object('object_chat_bot_relation').create(data);
                } catch (error) {
                    logger.error('创建机器人和群的关系失败：' + error.message);
                }
            }
        } catch (error) {
            logger.error('机器人加入群聊失败：' + error.message);
        }
    }
    logger.info('新增群聊时，机器人加入群聊完成');

    // 功能二
    // 获取全部群的群置顶数据
    const feishu_pins = await application.data.object('object_chat_pin').select('pin_name', 'pin_url', 'chat_rule', '_id').where({ all_chats: 'option_yes' }).find();
    // 循环所有群置顶数据，将符合规则的群置顶数据加入到群聊中
    for (const feishu_pin of feishu_pins) {
        if (feishu_pin.chat_rule == null) {
            continue;
        }

        // 将群置顶增加到群聊
        try {
            //创建群菜单 GroupTabCreate
            const group_tab = {
                pin_name: feishu_pin.pin_name,
                pin_url: feishu_pin.pin_url,
                pin_icon: null,
            };
            let group_tab_res = await faas.function('GroupTabCreate').invoke({ chat_id: feishu_chat_open_id, group_tab });

            if (group_tab_res.code !== 0) {
                logger.error('群置顶创建失败：' + group_tab_res.message);
            } else {
                try {
                    //存储apaas数据
                    const data = {
                        union_id: `${feishu_pin.pin_name}-${feishu_pin._id}-${feishu_chat_open_id}`,
                        chat_pin: { _id: feishu_pin._id },
                        chat: { _id: feishuChatId },
                    };
                    await application.data.object('object_chat_pin_relation').create(data);
                } catch (error) {
                    logger.error('创建群置顶和群的关系失败：' + error.message);
                }
            }
        } catch (error) {
            logger.error('群置顶创建失败：' + error.message);
        }
    }
    logger.info('新增群聊时，群置顶创建完成');

    // 功能三
    // 获取为全部群的群菜单分类 -> 只需要获取到的第一条
    const feishu_chat_menu_catalogs = await application.data
        .object('object_chat_menu_catalog')
        .select('name', 'description', 'chat_rule', '_id')
        .where({ all_chats: 'option_yes' })
        .find();

    for (const feishu_chat_menu_catalog of feishu_chat_menu_catalogs) {
        const feishu_chat_menu_catalog_id = feishu_chat_menu_catalog._id;
        if (feishu_chat_menu_catalog.chat_rule == null) {
            continue;
        }

        //获取符合规则的群列表
        const chatMenuRecordsPromise = application.data
            .object('object_chat_menu')
            .select(['_id', 'menu_catalog', 'name', 'menu_link', 'mobile_link', 'parent_menu'])
            .where({ menu_catalog: feishu_chat_menu_catalog_id })
            .find();

        // 获取分配的群聊列表和需要分配的菜单数据
        const [chatMenuRecords] = await Promise.all([chatMenuRecordsPromise]);

        const menu_data = convertRecordsToGroupMenu(chatMenuRecords); // 在循环内部消费 menu_data，所以这里不需要深拷贝


        try {
            // 1. 先获取群的菜单
            let current_chat_menu = await faas.function('GroupMenuFetch').invoke({ chat_id: feishu_chat_open_id });
            logger.info(`==> 获取群功能菜单结果：${JSON.stringify(current_chat_menu)}`);

            if (current_chat_menu?.code === 0 && current_chat_menu?.data.menu_tree?.chat_menu_top_levels.length === 0) {
                //当前群没有菜单，可以创建
                logger.info('==> 当前群没有菜单，可以创建\n');
            } else {
                // 当前群已有菜单，需要先对菜单进行清空
                logger.info('==> 当前群已有菜单，需要先对菜单进行清空删除');
                let chat_menu = current_chat_menu.data;
                let delete_res = await faas.function('GroupMenuDelete').invoke({ chat_id: feishu_chat_open_id, chat_menu });
                logger.info(`==> 删除群功能菜单结果：${JSON.stringify(delete_res)}`);
            }

            // 2. 创建群功能菜单
            let menu_res = await faas.function('GroupMenuCreate').invoke({ chat_id: feishu_chat_open_id, menu_data });
            logger.info(`==> 创建群功能菜单结果：${JSON.stringify(menu_res)}\n`);

            if (menu_res.code == 0) {
                logger.info(`==> 创建群功能菜单成功`);
                try {
                    const data = {
                        _id: feishuChatId,
                        chat_catalog: { _id: feishu_chat_menu_catalog_id },
                    };
                    await application.data.object('object_feishu_chat').update(data);
                    logger.info(`==> 创建群功能菜单关系数据完成`);
                    break;
                } catch {
                    logger.error(`==> 创建群功能菜单关系数据失败`);
                }
            } else {
                logger.error(`==> 群功能菜单创建失败，原因：${error.message}`);
            }
        } catch (error) {
            logger.error(`==> 群功能菜单创建失败，原因：${error.message}\n`);
        }
        break;
    }
    logger.info('新增群聊时，群功能菜单创建完成');
};
