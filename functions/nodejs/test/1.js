/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {

    const { apaasUserList } = params;

    logger.info('开始执行函数，参数:', params);

    if (!Array.isArray(apaasUserList) || apaasUserList.length === 0) {
        logger.warn('用户列表为空');
        return {
            code: 400,
            message: '用户列表为空',
            data: null,
        };
    }

    const client = await newLarkClient();
    logger.info('Lark 客户端初始化成功');

    const apaasUserIds = apaasUserList
        .map(user => {
            if (typeof user === 'string') {
                return user;
            } else if (typeof user === 'object' && user._id) {
                return user._id;
            }
            return null;
        })
        .filter(id => id !== null);

    logger.info('提取的用户 ID 列表:', apaasUserIds);

    let larkUserIdList = [];

    try {
        const apaasUserRecords = await fetchApaasUserRecords(logger, apaasUserIds, true);
        logger.info('从 aPaaS 获取到用户记录，包含 _lark_user_id:', apaasUserRecords);

        if (apaasUserRecords.some(record => '_lark_user_id' in record)) {
            larkUserIdList = apaasUserRecords.map(record => record._lark_user_id).filter(id => id).filter(id => id !== null);
            const result = {
                code: 0,
                message: 'success',
                data: larkUserIdList,
            };
            logger.info('最终返回数据:', result);
            return result;
        } else {
            logger.error('用户记录中不包含 _lark_user_id 字段');
            throw new Error('用户记录中不包含 _lark_user_id 字段');
        }
    } catch (error) {
        logger.error('尝试从用户表中获取用户飞书用户ID失败，错误信息：', error.message);
    }

    try {
        const apaasUserRecords = await fetchApaasUserRecords(logger, apaasUserIds, true);
        logger.info('从 aPaaS 获取到用户记录，不包含 _lark_user_id:', apaasUserRecords);

        const userIdData = formatGetUserIdData(apaasUserRecords);
        logger.info('格式化后的用户数据:', userIdData);

        const response = await batchGetUserId(logger, client, userIdData);
        logger.info('从飞书获取用户ID的响应:', JSON.stringify(response, null, 4));

        if (response.code === 0 && response.data.user_list.length > 0) {
            const userIdList = response.data.user_list.map(user => user.user_id).filter(id => id !== null);
            const result = {
                code: 0,
                message: 'success',
                data: userIdList,
            };
            logger.info('最终返回数据:', result);
            return result;
        } else {
            throw new Error('获取用户 ID 失败');
        }
    } catch (error) {
        logger.error('获取用户 ID 失败，错误信息：', error.message);
        const result = {
            code: 500,
            message: '获取用户 ID 失败',
            error,
            data: null,
        };
        logger.info('最终返回数据:', result);
        return result;
    }
};

/**
 * @description 从 aPaaS 中获取用户记录
 * @param {boolean} includeLarkId 是否包含 _lark_user_id 字段
 * @param {Logger} logger 日志记录器
 * @returns {Array} 用户记录数组
 */
async function fetchApaasUserRecords(logger, apaasUserIds, includeLarkId) {
    const apaasUserRecords = [];
    const selectFields = includeLarkId ? ['_id', '_email', '_phoneNumber', '_lark_user_id'] : ['_id', '_email', '_phoneNumber'];

    try {
        await application.data
            .object('_user')
            .select(...selectFields)
            .where({ _id: application.operator.in(apaasUserIds) })
            .findStream(async records => {
                apaasUserRecords.push(...records);
            });
        logger.info('获取到的用户记录:', apaasUserRecords);
    } catch (error) {
        logger.error('获取用户记录失败:', error.message);
        throw error;
    }

    return apaasUserRecords;
}

/**
 * @description 将 aPaaS 用户记录格式化为请求飞书接口通过手机号或邮箱获取用户ID的数据
 * @param {Array} apaasUserRecords 用户记录列表，包含用户邮箱和手机号字段
 * @returns {Object} 请求飞书接口时的参数数据
 */
function formatGetUserIdData(apaasUserRecords) {
    const result = {
        emails: [],
        mobiles: [],
    };

    apaasUserRecords.forEach(record => {
        if (!record._isDeleted) {
            if (record._phoneNumber && record._phoneNumber.number) {
                result.mobiles.push(record._phoneNumber.number);
            } else if (record._email) {
                result.emails.push(record._email);
            }
        }
    });

    return result;
}
