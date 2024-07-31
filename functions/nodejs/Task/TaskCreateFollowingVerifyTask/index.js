const dayjs = require('dayjs');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info('创建验收后续任务函数开始执行(TaskCreateFollowingVerifyTask)', params);
    let { verify_task } = params;

    // 找到任务记录
    let taskRecord = await application.data
        .object('object_store_task')
        .select('task_def', 'task_chat', 'task_handler', 'name')
        .where({ _id: verify_task.store_task?._id || verify_task.store_task.id })
        .findOne();
    logger.info('找到任务记录', taskRecord);

    if (!taskRecord) {
        logger.error('未找到任务记录，无法创建后续验收任务，返回 false');
        return { has_verify_task: false };
    }

    // 找到任务定义记录
    let taskDefineRecord = await application.data
        .object('object_task_def')
        .select('name', 'task_number', 'description', 'option_upload_image', 'option_input_information', 'option_upload_attachment', 'option_is_check', 'check_flow')
        .where({ _id: taskRecord.task_def?._id })
        .findOne();
    logger.info('找到任务定义记录', taskDefineRecord);

    if (!taskDefineRecord) {
        logger.error('未找到任务定义记录，无法创建后续验收任务，返回 false');
        return { has_verify_task: false };
    }

    // 查找任务验收流程记录
    let checkFlowRecord = await application.data
        .object('object_task_check_flow')
        .select('name', 'description', 'task_type')
        .where({ _id: taskDefineRecord.check_flow?._id || taskDefineRecord.check_flow.id })
        .findOne();
    logger.info('查找任务验收流程记录', checkFlowRecord);

    if (!checkFlowRecord) {
        logger.error('未找到任务验收流程记录，无法创建后续验收任务，返回 false');
        return { has_verify_task: false };
    }

    let checkFlowDetailRecord;
    let checkActivity = '';

    // 对验收任务中的验收节点字段进行判断，根据节点值判断是否需要创建后续验收任务
    switch (verify_task.check_activity) {
        case 'option_03':
            // 如果当前验收任务阶段是第三个阶段，则无需创建后续验收任务
            logger.info('当前验收任务阶段是第三个阶段，无需创建后续验收任务，返回 false');
            return { has_verify_task: false };

        case 'option_02':
            // 如果当前验收任务阶段是第二个阶段，则判断是否需要创建第三个阶段的验收任务
            checkFlowDetailRecord = await application.data
                .object('object_task_check_flow_detail')
                .select('check_flow', 'option_check_activity', 'option_relation_checkuser', 'checkuser', 'option_check_method', 'sampling_ratio')
                .where({ check_flow: checkFlowRecord?._id, option_check_activity: 'option_03' })
                .findOne();
            logger.info('查找第三个阶段的验收流程明细记录', checkFlowDetailRecord);

            if (!checkFlowDetailRecord) {
                logger.info('未找到第三个阶段的验收流程明细记录，无需创建后续验收任务，返回 false');
                return { has_verify_task: false };
            }
            checkActivity = 'option_03';
            break;

        case 'option_01':
            // 如果当前验收任务阶段是第一个阶段，则查找 option_check_activity: 'option_02' 的任务验收流程明细记录
            checkFlowDetailRecord = await application.data
                .object('object_task_check_flow_detail')
                .select('check_flow', 'option_check_activity', 'option_relation_checkuser', 'checkuser', 'option_check_method', 'sampling_ratio')
                .where({ check_flow: checkFlowRecord?._id, option_check_activity: 'option_02' })
                .findOne();
            logger.info('查找第二个阶段的验收流程明细记录', checkFlowDetailRecord);

            if (!checkFlowDetailRecord) {
                logger.info('未找到第二个阶段的验收流程明细记录，无需创建后续验收任务，返回 false');
                return { has_verify_task: false };
            }
            checkActivity = 'option_02';
            break;

        default:
            // 如果当前的验收任务阶段不在预期范围内，返回 false
            return { has_verify_task: false };
    }

    logger.info('经过判断，需要创建后续验收任务', checkFlowDetailRecord);

    let checkTaskHandler = {};

    // 最优先判断：如果验收流程明细记录中的指定验收人不为空，则直接使用
    if (checkFlowDetailRecord.checkuser && checkFlowDetailRecord.checkuser._id) {
        checkTaskHandler = { _id: checkFlowDetailRecord.checkuser._id };
    } else {
        // 根据验收流程明细记录中的关联验收人字段，查找对应的用户记录
        switch (checkFlowDetailRecord.option_relation_checkuser) {
            case 'option_store_manager':
                let chatRecord = await application.data
                    .object('object_feishu_chat')
                    .select('chat_owner')
                    .where({ _id: taskRecord.task_chat?._id || taskRecord.task_chat.id })
                    .findOne();
                logger.info('查找任务对应的飞书群记录', chatRecord);

                if (chatRecord && chatRecord.chat_owner) {
                    checkTaskHandler = { _id: chatRecord.chat_owner._id };
                }
                break;

            case 'option_supervisor':
                let managerRecord = await application.data
                    .object('_user')
                    .select('_id', '_manager')
                    .where({ _id: taskRecord.task_handler?._id || taskRecord.task_handler.id })
                    .findOne();
                logger.info('查找任务对应的主管记录', managerRecord);

                if (managerRecord && managerRecord._manager) {
                    checkTaskHandler = { _id: managerRecord._manager._id };
                }
                break;

            case 'option_up_supervisor':
                let supervisorRecord = await application.data
                    .object('_user')
                    .select('_id', '_manager')
                    .where({ _id: taskRecord.task_handler?._id || taskRecord.task_handler.id })
                    .findOne();
                logger.info('查找任务对应的主管记录', supervisorRecord);

                if (supervisorRecord) {
                    let upSupervisorRecord = await application.data
                        .object('_user')
                        .select('_id', '_manager')
                        .where({ _id: supervisorRecord._manager?._id || supervisorRecord._manager.id })
                        .findOne();
                    checkTaskHandler = upSupervisorRecord
                        ? { _id: upSupervisorRecord._manager?._id || upSupervisorRecord._manager.id }
                        : { _id: supervisorRecord._manager._id };
                }
                break;

            case 'option_publisher':
                checkTaskHandler = { _id: taskRecord.task_handler._id };
                break;

            default:
                checkTaskHandler = { _id: 1 };
                break;
        }
    }

    if (!checkTaskHandler._id) {
        logger.error('未找到验收任务处理人，无法创建后续验收任务，返回 false');
        return { has_verify_task: false };
    }

    let verifyTask = {
        store_task: { _id: taskRecord._id },
        task_name: `【验收】${taskRecord.name}`,
        task_handler: checkTaskHandler,
        task_status: 'option_pending',
        task_create_time: dayjs().valueOf(),
        check_activity: checkActivity,
    };

    let verifyTaskRecord = await application.data.object('object_task').create(verifyTask);
    logger.info('创建验收任务成功', { ...verifyTask, ...verifyTaskRecord });

    return { has_verify_task: true };
};