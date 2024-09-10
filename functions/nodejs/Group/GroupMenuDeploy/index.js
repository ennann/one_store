// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const {convertRecordsToGroupMenu} = require('../GroupMenuUtils/groupMenuConstructor');
const {batchOperation, createLimiter, sleep} = require('../../utils');
const dayjs = require('dayjs');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {

    logger.info('测试分发菜单接口入参：', params)
    const {chat_menu_catalog} = params;

    if (!chat_menu_catalog || !chat_menu_catalog._id) {
        logger.error('错误：缺少菜单目录信息，请确认传入的参数是否正确');
        return {
            code: -1,
            message: '错误：缺少菜单目录信息，请确认传入的参数是否正确',
        };
    }

    // 删除历史群群菜单的操作
    const deleteFeiShuGroupMenuHistory = async (chat_id) => {
        try {
            // 1. 先获取群的菜单
            let current_chat_menu = await faas.function('GroupMenuFetch').invoke({chat_id});
            if (current_chat_menu.code !== 0) {
                throw new Error(`获取群功能菜单失败，群聊${chat_id}，原因：${current_chat_menu.message}`);
            }

            if (current_chat_menu?.code === 0 && current_chat_menu?.data.menu_tree?.chat_menu_top_levels?.length > 0) {
                // 当前群已有菜单，需要先对菜单进行清空
                let chat_menu = current_chat_menu.data;
                let delete_res = await faas.function('GroupMenuDelete').invoke({chat_id, chat_menu});
                if (delete_res.code !== 0) {
                    throw new Error(`删除群功能菜单失败，群聊${chat_id}，原因：${delete_res.message}`);
                }
            }

        } catch (error) {
            return {code: -1, chat_id, message: error.message || `未知错误，群聊${chat_id}，`, result: 'failed'};
        }
    }
    // 创建限流器
    const limitedDeleteFeiShuGroupMenus = createLimiter(deleteFeiShuGroupMenuHistory);
    //删除已分发的apass飞书群记录
    await deleteFeiShuGroupMenu(chat_menu_catalog, limitedDeleteFeiShuGroupMenus, logger);
    try {
        await baas.redis.set("GroupMenuDeploy","Y");
        const distributionChatListPromise = faas.function('DeployChatRange').invoke({deploy_rule: chat_menu_catalog.chat_rule});

        const chatMenuRecordsPromise = application.data
            .object('object_chat_menu')
            .select(['_id', 'menu_catalog', 'name', 'menu_link', 'mobile_link', 'parent_menu'])
            .where({menu_catalog: chat_menu_catalog._id || chat_menu_catalog.id})
            .orderBy("number")
            .find();

        // 获取分配的群聊列表和需要分配的菜单数据
        const [chatRecordList, chatMenuRecords] = await Promise.all([distributionChatListPromise, chatMenuRecordsPromise]);
        const chatIdList = chatRecordList.map(item => item.chat_id);

        if (!chatIdList || chatIdList.length === 0 || !chatMenuRecords || chatMenuRecords.length === 0) {
            logger.error('查询结果为空，未找到对应的群聊或菜单数据');
            return {
                code: -2,
                message: '未找到对应的群聊或菜单数据，无法分发',
            };
        }

        const menu_data = convertRecordsToGroupMenu(chatMenuRecords); // 在循环内部消费 menu_data，所以这里不需要深拷贝

        // 定义将群菜单设置到群聊的函数
        const setGroupMenu = async (chat_id, menu_data) => {
            try {
                // 1. 先获取群的菜单
                let current_chat_menu = await faas.function('GroupMenuFetch').invoke({chat_id});
                if (current_chat_menu.code !== 0) {
                    throw new Error(`获取群功能菜单失败，群聊${chat_id}，原因：${current_chat_menu.message}`);
                }

                if (current_chat_menu?.code === 0 && current_chat_menu?.data.menu_tree?.chat_menu_top_levels?.length > 0) {
                    // 当前群已有菜单，需要先对菜单进行清空
                    let chat_menu = current_chat_menu.data;
                    let delete_res = await faas.function('GroupMenuDelete').invoke({chat_id, chat_menu});
                    if (delete_res.code !== 0) {
                        throw new Error(`删除群功能菜单失败，群聊${chat_id}，原因：${delete_res.message}`);
                    }
                }

                // 2. 创建群功能菜单
                let menu_res = await faas.function('GroupMenuCreate').invoke({chat_id, menu_data});

                if (menu_res.code !== 0) {
                    throw new Error(`创建群功能菜单失败，群聊${chat_id}，原因：${menu_res.message}`);
                }

                return {code: 0, chat_id, message: `创建群功能菜单成功，群聊${chat_id}`, result: 'success',};
            } catch (error) {
                return {code: -1, chat_id, message: error.message || `未知错误，群聊${chat_id}，`, result: 'failed'};
            }
        }

        // 创建限流器
        const limitedSetGroupMenu = createLimiter(setGroupMenu);

        // 并行执行群菜单设置的操作
        logger.info(`应设置群菜单总数：${chatIdList.length}`);
        let successRecords = [];
        let failRecords = [];
        if (chatIdList.length > 0) {
            // 分批操作飞书侧
            const fsBatchSize = 10;
            let recallRecordResults = [];
            for (let i = 0; i < chatIdList.length; i += fsBatchSize) {
                let slice = chatIdList.slice(i, i + fsBatchSize);
                // 获取调用开始时间
                const startTime = dayjs.valueOf();
                const recallResult = await Promise.all(slice.map(chat_id => limitedSetGroupMenu(chat_id, menu_data)));
                const endTime = dayjs.valueOf();
                recallRecordResults = [...recallRecordResults, ...recallResult]
                await sleep(1000 - (endTime - startTime));
            }
            // 操作 apaas 侧
            logger.info(`飞书侧操作结束，开始操作 apaas 侧，总数：${recallRecordResults.length}`)

            const successRecord = recallRecordResults.filter(result => result?.code === 0);
            const failRecord = recallRecordResults.filter(result => result?.code !== 0);
            successRecords.push(...successRecord);
            failRecords.push(...failRecord);
            logger.info(`分流设置群菜单总数：${recallRecordResults.length}; 成功数量：${successRecord.length}; 失败数量：${failRecord.length}`);

            const batchUpdateData = successRecord.map(item => ({
                _id: chatRecordList.find(chat => chat.chat_id === item.chat_id)._id,
                chat_catalog: {_id: chat_menu_catalog._id},
            }));

            if (batchUpdateData.length > 0) {
                await batchOperation(logger, "object_feishu_chat", "batchUpdate", batchUpdateData);
                logger.info(`分流更菜单对应群组个数->`, batchUpdateData.length);
            }
            logger.info(`创建群菜单关系总数：${chatIdList.length}; 成功数量：${successRecords.length}; 失败数量：${failRecords.length}`);
        }

        return {
            code: successRecords.length > 0 ? 0 : -1,
            message: '批量更新群菜单字段完成',
            data: {
                success_count: successRecords.length,
                success_list: successRecords,
                failed_count: failRecords.length,
                failed_list: failRecords,
            },
        };
    }catch (e) {
        logger.error('更新群菜单失败', e);
    }finally {
        await baas.redis.del("GroupMenuDeploy");
    }
};

const deleteFeiShuGroupMenu = async (chat_menu_catalog, limitedDeleteFeiShuGroupMenus, logger) => {
    try {
        logger.info('开始删除飞书群菜单')
        //获取群菜单历史分发群
        const result = [];
        await application.data.object('object_feishu_chat')
            .select('_id', 'chat_id')
            .where({chat_catalog: {_id: chat_menu_catalog._id}})
            .findStream(async records => {
                result.push(...records.map(item => ({_id: item._id, chat_id: item.chat_id})));
            });
        if (result.length > 0) {
            // 分批操作飞书侧
            logger.info(`飞书侧操作总数：${result.length}`);
            try {
                const recallResult = await Promise.all(result.map(item => limitedDeleteFeiShuGroupMenus(item.chat_id)));
            } catch (e) {
                logger.error('批量删除飞书群菜单失败：' + e);
            }
        }
        // 根据成功列表准备批量更新数据
        const batchUpdateData = result.map(item => ({
            _id: item._id,
            chat_catalog: null,
        }));
        // // 开始批量创建数据
        if (batchUpdateData.length > 0) {
            await batchOperation(logger, "object_feishu_chat", "batchUpdate", batchUpdateData);
            logger.info(`分流更新完成个数->`, batchUpdateData.length);
        }
    } catch (error) {
        logger.error('批量更新飞书群菜单字段完失败：' + error);
    }
};
