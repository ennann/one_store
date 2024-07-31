const { fetchDepartmentInfoById, newLarkClient } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info('用户信息变更函数开始执行', params);

    const { old_object, object } = params.event.event;
    const { email, name, open_id, user_id } = object;
    const oldDepartmentList = old_object.department_ids;
    const newDepartmentList = object.department_ids;

    logger.info(`用户 ${name} (${email}) 的部门信息从 ${oldDepartmentList} 变更为 ${newDepartmentList}`);

    if (oldDepartmentList && oldDepartmentList[0] === newDepartmentList[0]) {
        return { code: -1, message: '用户第一个部门信息未发生变化（由于飞书可以配置多个部门，但是 aPaaS 只能配置一个部门，所以只取第一个部门）' };
    }

    const userRecord = await application.data.object('_user').select('_id', '_name', '_email').where({ _lark_user_id: user_id }).findOne();

    if (!userRecord) {
        logger.error(`用户 ${name} ${user_id} 的信息在 aPaaS 不存在`);
        return { code: -1, message: `用户 ${name} ${user_id} 的信息在 aPaaS 不存在` };
    }

    const client = await newLarkClient({ userId: context.user._id }, logger);

    let oldDepartmentInfo;
     // 判断老部门的id是否传入
    if (oldDepartmentList){
        oldDepartmentInfo = await fetchDepartmentInfoById(client, oldDepartmentList[0]);
    }
    const newDepartmentInfo = await fetchDepartmentInfoById(client, newDepartmentList[0]);

    // 从 aPaaS 中查找新旧部门信息
    let oldDepartmentRecord;
    if (oldDepartmentInfo){
        oldDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _name: oldDepartmentInfo.name }).findOne();
    }
    const newDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _name: newDepartmentInfo.name }).findOne();

    // 1. 处理旧部门信息
    if (oldDepartmentRecord) {
        logger.info('在 aPaaS 中找到旧部门信息', oldDepartmentRecord);

        const oldDepartmentChatGroup = await application.data
            .object('object_feishu_chat')
            .select('_id', 'chat_id', 'chat_link', 'chat_group_type')
            .where({ department: oldDepartmentRecord._id, chat_group_type: 'option_business' })
            .findOne();

        if (oldDepartmentChatGroup) {
            logger.info('旧部门的群聊信息', oldDepartmentChatGroup);
            const oldDepStore = await application.data
                .object('object_store')
                .select('_id')
                .where({ store_department: oldDepartmentRecord._id })
                .findOne();

            const oldDepAllStoreStaff = await application.data
                .object('object_store_staff')
                .select('_id')
                .where({
                    store_staff: userRecord._id,
                    store: oldDepStore._id
                }).find();

            const idArray = oldDepAllStoreStaff.map(item => item._id);

            if (idArray.length > 0) {
                await application.data.object('object_store_staff').batchDelete(idArray);
                logger.info('删除该部门下的该员工的所有门店成员信息成功');
            } else {
                logger.warn('未找到该员工在该部门下的门店成员信息, 无需删除');
            }
            logger.info('飞书群id',oldDepartmentChatGroup._id,'群成员id' ,userRecord._id)

            const chatMemberRecord = await application.data
                .object('object_chat_member')
                .select('_id')
                .where({
                    store_chat: {_id:oldDepartmentChatGroup._id},
                    chat_member: {_id:userRecord._id}
                }).findOne();

            logger.info('获取到的飞书群成员信息', chatMemberRecord);

            if (chatMemberRecord) {
                await application.data.object('object_chat_member').delete(chatMemberRecord._id);
            }

            try {
                const res = await client.im.chatMembers.delete({
                    path: { chat_id: oldDepartmentChatGroup.chat_id },
                    params: { member_id_type: 'open_id' },
                    data: { id_list: [open_id] },
                });

                if (res.code !== 0) {
                    logger.error('将用户从旧的部门群聊中移除失败', res);
                }
            } catch (error) {
                logger.error('将用户从旧的部门群聊中移除失败', error);
            }
        } else {
            logger.warn('未找到旧部门的群聊信息，无需处理', oldDepartmentInfo);
        }
    } else {
        logger.warn('在 aPaaS 中未找到旧部门信息', oldDepartmentInfo);
    }

    // 处理新部门信息
    if (newDepartmentRecord) {
        logger.info('在 aPaaS 中找到新部门信息', newDepartmentRecord);

        const newDepartmentChatGroup = await application.data
            .object('object_feishu_chat')
            .select('_id', 'chat_id', 'chat_link', 'chat_group_type')
            .where({ department: newDepartmentRecord._id, chat_group_type: 'option_business' })
            .findOne();

        if (newDepartmentChatGroup) {
            await application.data.object('object_chat_member').create({
                store_chat: { _id: newDepartmentChatGroup._id },
                chat_member: { _id: userRecord._id },
                chat_member_role: 'option_group_member',
            });

            logger.info('将用户在 aPaaS 的群成员内创建记录成功');

            try {
                const res = await client.im.chatMembers.create({
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

            const newStore = await application.data.object('object_store').select('_id').where({ store_department: newDepartmentRecord._id }).findOne();
            if (newStore) {
                await application.data.object('object_store_staff').create({
                    store_staff: { _id: userRecord._id },
                    store_staff_department: { _id: newDepartmentRecord._id },
                    store: { _id: newStore._id },
                });
            }
        } else {
            logger.warn('未找到新部门的 aPaaS 群聊信息，无需处理', newDepartmentInfo);
        }
    } else {
        logger.warn('在 aPaaS 中未找到新部门信息', newDepartmentInfo);
    }

    logger.info(`完成用户 ${name} (${email}) 在 aPaaS 的部门变更。旧部门为：${JSON.stringify(oldDepartmentRecord)} 新部门为：${JSON.stringify(newDepartmentRecord)}`);
    return { code: 0, message: '部门变更处理完成' };
};
