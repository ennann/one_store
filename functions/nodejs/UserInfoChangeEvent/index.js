// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
const { fetchDepartmentInfoById } = require('../utils');
const { newLarkClient } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info('用户信息变更函数开始执行', params);

    // 根据事件传送过来的信息，判断用户部门信息是否发生变化，并触发相应的操作

    // 在飞书，部门信息为必填项，所以用户的部门信息不可能为空
    const oldDepartmentList = params.event.event.old_object.department_ids;
    const newDepartmentList = params.event.event.object.department_ids;
    const { email, name, open_id, user_id } = params.event.event.object; // 变更的用户信息
    logger.info(`用户 ${name} (${email})的部门信息发生变更，从 ${oldDepartmentList} 变更为 ${newDepartmentList}`);

    // 如果变更后的部门一致，则不做任何操作
    if (oldDepartmentList[0] === newDepartmentList[0]) {
        return { code: -1, message: '用户第一个部门信息未发生变化' };
    }

    // 邮箱查询变更为手机号查询apaas用户
    const userRecord = await application.data.object('_user').select('_id', '_name', '_email').where({ _lark_user_id: user_id }).findOne();

    if (!userRecord) {
        logger.error('用户信息不存在');
        return { code: -1, message: `用户 ${name} ${user_id} 的信息在 aPaaS 不存在` };
    }

    const client = await newLarkClient({ userId: context.user._id }, logger);

    // // 默认只获取第一个部门信息
    let oldDepartmentOpenId = oldDepartmentList[0];
    let newDepartmentOpenId = newDepartmentList[0];

    if (oldDepartmentOpenId || newDepartmentOpenId) {
        // // 获取部门信息
        // const oldDepartmentInfo = await fetchDepartmentInfoById(oldDepartmentOpenId, client);
        // const newDepartmentInfo = await fetchDepartmentInfoById(newDepartmentOpenId, client);
        logger.error(`事件订阅推送的部门信息不完整，旧部门：${JSON.stringify(oldDepartmentList)}，新部门：${JSON.stringify(newDepartmentList)}`);
        return { code: -1, message: '部门信息在 aPaaS 不存在' };
    }

    // 根据部门名称获取部门 aPaaS 记录
    let oldDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _lark_department_id: oldDepartmentOpenId }).findOne();
    let newDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _lark_department_id: newDepartmentOpenId }).findOne();

    // 如果 aPaaS 中不存在新的部门记录
    if (!newDepartmentRecord) {
        logger.error('新部门信息不存在');
        return { code: -1, message: '新部门信息在 aPaaS 不存在' };
    }

    // 1. 开始处理新部门信息

    // 找到新的部门的群聊(部门相同，群类型等于 option_business 经营群)
    let newDepartmentChatGroup = await application.data
        .object('object_feishu_chat')
        .select('_id', 'chat_id', 'chat_link', 'chat_group_type')
        .where({ department: newDepartmentRecord._id || newDepartmentRecord.id, chat_group_type: 'option_business' })
        .findOne();

    // let oldDepartmentChatGroup = await application.data.object('object_feishu_chat').select('_id', 'chat_id', 'chat_link', 'chat_group_type').where({ department: oldDepartmentRecord._id, chat_group_type: 'option_business' }).findOne();
    let oldDepartmentChatGroup;
    if (oldDepartmentOpenId != 0 && oldDepartmentRecord) {
        oldDepartmentChatGroup = await application.data
            .object('object_feishu_chat')
            .select('_id', 'chat_id', 'chat_link', 'chat_group_type')
            .where({ department: oldDepartmentRecord._id || oldDepartmentRecord.id, chat_group_type: 'option_business' })
            .findOne();
    }

    // 创建群成员记录，将用户拉入群聊 aPaaS
    if (newDepartmentChatGroup) {
        await application.data.object('object_chat_member').create({
            store_chat: { _id: newDepartmentChatGroup._id },
            chat_member: { _id: userRecord._id },
            chat_member_role: 'option_group_member',
        });
        logger.info('将用户在 aPaaS 的群成员内创建记录成功');

        // 将用户拉入新的部门群聊（飞书平台）
        try {
            let res = await client.im.chatMembers.create({
                path: { chat_id: newDepartmentChatGroup.chat_id },
                params: { member_id_type: 'open_id' },
                data: { id_list: [open_id] },
            });

            if (res.code !== 0) {
                logger.error('将用户拉入新的部门群聊失败', res);
            }
        } catch (error) {
            logger.error('将用户拉入新的部门群聊失败', error);
        }
    }

    // 根据组织找到门店，（默认一个组织只有一个门店）
    const newStore = await application.data.object('object_store').select('_id').where({ store_department: newDepartmentRecord._id }).findOne();
    if (newStore) {
        // 将用户拉入新的门店成员
        await application.data.object('object_store_staff').create({
            store_staff: { _id: userRecord._id },
            store_staff_department: { _id: newDepartmentRecord._id },
            store: { _id: newStore._id },
        });
    }

    // 2. 开始处理旧部门信息

    // 将用户从旧的部门群聊中移除（飞书群成员 apaas）
    if (oldDepartmentChatGroup) {
        // 删除该用户在该部门下所在的门店成员信息

        // 1.获取老部门的id
        const oldDepId = oldDepartmentRecord._id;
        // 2.获取该部门下的所有门店信息
        const oldDepAllStore = await application.data
            .object('object_store_staff')
            .select('_id', 'store_staff_department', 'store_staff')
            .where({
                store_staff: userRecord._id,
                store_staff_department: oldDepId,
            })
            .find();

        // 3.删除该部门下的该员工的所有门店成员信息
        let idArray = oldDepAllStore.map(item => item._id); // 提取每个对象的 _id 属性值，生成新的数组

        await application.data.object('object_store_staff').batchDelete(idArray);

        let chatMemberRecord = await application.data
            .object('object_chat_member')
            .select('_id')
            .where({ store_chat: oldDepartmentChatGroup._id, chat_member: userRecord._id })
            .findOne();

        if (chatMemberRecord) {
            await application.data.object('object_chat_member').delete(chatMemberRecord._id);
        }

        try {
            // 将用户从旧的部门群聊中移除（飞书群成员 飞书平台）
            let res = await client.im.chatMembers.delete({
                path: { chat_id: oldDepartmentChatGroup.chat_id },
                params: { member_id_type: 'open_id' },
                data: { id_list: [open_id] },
            });
            if (res.code !== 0) {
                logger.error('将用户从旧的部门群聊中移除失败', res);
            }
        } catch (error) {
            logger.error('将用户从旧的部门群聊中移除失败', error);
            // return { code: -1, message: '将用户从旧的部门群聊中移除失败' };
        }
    }

    logger.info('用户信息变更函数执行完毕');
};
