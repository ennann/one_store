const { newLarkClient } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const undoneList = [];
    await application.data
        .object('object_store_task')
        .where({
            task_guid: application.operator.notEmpty(),
            task_status: 'option_pending',
        })
        .select('_id', 'task_guid')
        .findStream(async records => undoneList.push(...records));

    const client = await newLarkClient({ userId: context.user._id }, logger);
    for (const { task_guid, _id } of undoneList) {
        const res = await await client.task.v2.task.get({
            path: { task_guid },
        });
        if (res.code === 0) {
            const { task } = res.data;
            if (task?.completed_at) {
                await application.data.object('object_store_task').update(_id, {
                    task_status: 'option_completed',
                    task_finish_time: new Date(task.completed_at).getTime(),
                });
            }
        }
    }
};
