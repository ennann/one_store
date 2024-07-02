const { newLarkClient, batchOperation } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    try {
        logger.info(`汇总用户职务函数开始执行 ${new Date()}`);

        const client = await newLarkClient({ userId: context.user._id }, logger);

        const feishuJobRecords = await getFeishuJobRecords(client);
        logger.info(`Feishu 职务数据：${JSON.stringify(feishuJobRecords)}`);

        if (!feishuJobRecords.length) {
            logger.info('Feishu 职务数据为空');
            return;
        }

        const apaasJobRecords = await getApaasJobRecords();
        logger.info(`aPaaS 职务数据：${JSON.stringify(apaasJobRecords)}`);

        const { updateRecords, createRecords, deleteRecords } = syncJobRecords(feishuJobRecords, apaasJobRecords);

        logger.info(`批量更新的职务数据：${JSON.stringify(updateRecords)}`);
        logger.info(`批量创建的职务数据：${JSON.stringify(createRecords)}`);
        logger.info(`批量删除的职务数据：${JSON.stringify(deleteRecords)}`);

        await batchOperation(logger, 'object_job_position', 'batchUpdate', updateRecords);
        await batchOperation(logger, 'object_job_position', 'batchCreate', createRecords);
        await batchOperation(logger, 'object_job_position', 'batchDelete', deleteRecords);
    } catch (error) {
        logger.error(`汇总用户职务函数执行失败: ${error.message}`);
    }
};

/**
 * @description 获取 Feishu 职务数据
 * @param {*} client 
 * @returns 
 */
async function getFeishuJobRecords(client) {
    const feishuJobRecords = [];

    for await (const item of await client.contact.jobTitle.listWithIterator({
        params: { page_size: 50 },
    })) {
        feishuJobRecords.push(...item.items);
    }

    return feishuJobRecords;
}

/**
 * @description 获取 aPaaS 职务数据
 * @returns 
 */
async function getApaasJobRecords() {
    const apaasJobRecords = [];
    await application.data
        .object('object_job_position')
        .select('job_code', 'job_name', '_id')
        .findStream(records => apaasJobRecords.push(...records));
    return apaasJobRecords;
}

/**
 * @description 同步 Feishu 和 aPaaS 的职务数据
 * @param {Array} feishuJobRecords 
 * @param {Array} apaasJobRecords 
 * @returns 
 */
function syncJobRecords(feishuJobRecords, apaasJobRecords) {
    const updateRecords = feishuJobRecords
        .map(feishuJobRecord => {
            const apaasJobRecord = apaasJobRecords.find(item => item.job_code === feishuJobRecord.job_title_id);
            return apaasJobRecord ? { _id: apaasJobRecord._id, job_name: feishuJobRecord.name } : null;
        })
        .filter(record => record !== null);

    const createRecords = feishuJobRecords
        .filter(feishuJobRecord => !apaasJobRecords.some(item => item.job_code === feishuJobRecord.job_title_id))
        .map(feishuJobRecord => ({
            job_code: feishuJobRecord.job_title_id,
            job_name: feishuJobRecord.name,
        }));

    const deleteRecords = apaasJobRecords
        .filter(apaasJobRecord => !feishuJobRecords.some(item => item.job_title_id === apaasJobRecord.job_code))
        .map(apaasJobRecord => apaasJobRecord._id);

    return { updateRecords, createRecords, deleteRecords };
}