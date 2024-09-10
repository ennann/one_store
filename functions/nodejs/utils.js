const Bottleneck = require('bottleneck');
const lark = require('@larksuiteoapi/node-sdk');
const parsePhoneNumber = require('libphonenumber-js');
const { chunk } = require('lodash');
const qs = require('qs');

/**
 *
 * @param {{ userId: String} params
 * @param {Logger} logger
 * @returns {lark.Client}
 */
async function newLarkClient(params, logger) {
    const { userId } = params || {};
    const { appId, tenantAccessToken } = await application.integration.getDefaultTenantAccessToken();

    const client = new lark.Client({ appId, appSecret: 'fake' });
    client.tokenManager.cache.set(lark.CTenantAccessToken, tenantAccessToken, null, { namespace: appId });
    client.httpInstance.interceptors.response.use(
        resp => resp,
        async error => {
            const detail = ['接口：', error.request.path, '，失败原因：', error.response.data.msg];
            if (error.response.data.error?.helps?.length) {
                detail.push(...['，参考链接：', error.response.data.error.helps[0].url]);
            }
            logger && logger.info('调用开放平台接口失败，', ...detail);

            //   if (userId) {
            //     try {
            //       await application.msg.notifyCenter.create({
            //         icon: 'error',
            //         title: new kunlun.type.Multilingual({
            //           zh: '调用开放平台接口失败',
            //         }),
            //         detail: new kunlun.type.Multilingual({
            //           zh: detail.join(''),
            //         }),
            //         target_users: [userId],
            //       });
            //     } catch (e) { }
            //   }

            return Promise.reject(error);
        },
    );

    return client;
}

/**
 *
 * @param {Logger} logger
 * @returns {lark.Client}
 */
async function createLarkClient() {
    const { appId, tenantAccessToken } = await application.integration.getDefaultTenantAccessToken();

    const client = new lark.Client({ appId, appSecret: 'fake', disableTokenCache: false });
    client.tokenManager.cache.set(lark.CTenantAccessToken, tenantAccessToken, null, { namespace: appId });

    return client;
}

/**
 * @description 限流器
 * @param {*} fn
 * @param {*} options
 * @returns
 */
function createLimiter(fn, options = {}) {
    const { perSecond = 50, perMinute = 1000 } = options;

    // const secondLimiter = new Bottleneck({
    //     reservoir: perSecond,
    //     reservoirRefreshAmount: perSecond,
    //     maxConcurrent: 1,
    //     minTime: 60,
    //     reservoirRefreshInterval: 1000,
    // });

    // const minuteLimiter = new Bottleneck({
    //     reservoir: perMinute,
    //     reservoirRefreshAmount: perMinute,
    //     reservoirRefreshInterval: 60 * 1000,
    // });

    const limiter = new Bottleneck({
        reservoir: 15, // 初始值，每秒允许15个请求
        reservoirRefreshAmount: 15, // 每次刷新时将 reservoir 重置为 15
        reservoirRefreshInterval: 1000, // 每秒刷新一次，即 1000 毫秒
        maxConcurrent: 15, // 同时允许的最大请求数为 15
        minTime: 0, // 请求之间没有最小时间间隔
    });

    return limiter.wrap(fn);
}

/**
 * @description 根据用户邮箱获取开放平台的 user_id
 * @param emails
 * @param logger
 * @return {Promise<*[]>}
 */
async function getUserIdByEmails(emails, logger) {
    const client = await newLarkClient({ userId: 0 }, logger);

    try {
        let user_info = await client.contact.user.batchGetId({
            params: { user_id_type: 'user_id' },
            data: { emails },
        });

        if (user_info.code !== 0) {
            logger.error('查询用户信息失败');
            return [];
        }

        return user_info.data.user_list.map(user => user.user_id);
    } catch (e) {
        logger.error('查询用户信息失败');
        return [];
    }
}

/**
 * @description 根据用户邮箱获取开放平台的 open_id
 * @param emails
 * @param mobiles
 * @param logger
 * @return {Promise<*[]>}
 */
async function getOpenIdByEmailsOrMobiles(emails, mobiles, logger) {
    const client = await newLarkClient({ userId: 0 }, logger);
    try {
        let user_info = await client.contact.user.batchGetId({
            params: { user_id_type: 'open_id' },
            data: {
                emails: emails,
                mobiles: mobiles,
                include_resigned: true,
            },
        });

        if (user_info.code !== 0) {
            logger.error('查询用户信息失败user_info：' + user_info);
            return [];
        }
        return user_info;
    } catch (e) {
        logger.error('查询用户信息失败e：' + e);
        return [];
    }
}

/**
 * 根据邮箱或手机号获取单个 aPaaS 用户
 *
 * @param {{ email: string; mobile: string }} params
 */
async function getaPaaSUser(params) {
    const { email, mobile } = params;

    let phoneNumber = null;
    if (mobile) {
        try {
            phoneNumber = parsePhoneNumber(mobile)?.nationalNumber || mobile;
        } catch (e) {
            phoneNumber = mobile;
        }
    }

    return await application.data
        .object('_user')
        .select(['_id', '_phoneNumber', '_email', '_avatar', '_name', '_nickname'])
        .where(
            application.operator.or(
                application.operator.and({ _email: application.operator.notEmpty() }, { _email: email }),
                application.operator.and({ _phoneNumber: application.operator.notEmpty() }, { _phoneNumber: phoneNumber }),
            ),
        )
        .findOne();
}

/**
 * 根据邮箱或手机号批量获取多个 aPaaS 用户
 *
 * @param {{ emails: Array<string>; mobiles: Array<string> }} params
 */
async function getaPaaSUsers(params) {
    const { emails = [], mobiles = [] } = params;

    const phoneNumbers = mobiles.map(mobile => {
        try {
            return parsePhoneNumber(mobile)?.nationalNumber || mobile;
        } catch (e) {
            return mobile;
        }
    });

    const users = [];

    if (emails.length > 0 || phoneNumbers.length > 0) {
        await application.data
            .object('_user')
            .select(['_id', '_phoneNumber', '_email', '_avatar', '_name', '_nickname'])
            .where(
                application.operator.or(
                    ...[
                        emails.length > 0 ? { _email: application.operator.in(emails) } : null,
                        phoneNumbers.length > 0 ? { _phoneNumber: application.operator.in(phoneNumbers) } : null,
                    ].filter(cond => cond),
                ),
            )
            .findStream(records => users.push(...records));
    }

    return users;
}

/**
 * 根据飞书开放平台 user open_id 获取 aPaaS 用户
 *
 * @param {lark.Client} client
 * @param {string} openId
 */
async function getUserByOpenId(client, openId) {
    try {
        const userRes = await client.contact.user.get({
            path: { user_id: openId },
            params: { user_id_type: 'open_id' },
        });
        if (userRes.code === 0) {
            const { email, mobile } = userRes.data.user;
            return await getUser({ email, mobile });
        }
    } catch (e) {}
}

/**
 * 根据飞书开放平台 user open_id 数组批量获取 aPaaS 用户
 *
 * @param {lark.Client} client
 * @param {Array<string>} openIds
 */
async function getUsersByOpenId(client, openIds) {
    const emails = [];
    const mobiles = [];

    await Promise.all(
        chunk(openIds, 50).map(async ids => {
            const params = qs.stringify({ user_ids: ids, user_id_type: 'open_id' }, { arrayFormat: 'repeat' });
            try {
                const usersRes = await client.request({
                    method: 'GET',
                    url: `/open-apis/contact/v3/users/batch?${params}`,
                });
                if (usersRes.code === 0) {
                    usersRes.data.items.map(item => {
                        if (item.email) {
                            emails.push(item.email);
                        }
                        if (item.mobile) {
                            mobiles.push(item.mobile);
                        }
                    });
                }
            } catch (e) {}
        }),
    );

    return await getUsers({ emails, mobiles });
}

/**
 * @description 对 aPaaS 数据对象进行批量操作
 * @param logger
 * @param objectName
 * @param operationType
 * @param operationArray
 * @param pageSize
 * @return {Promise<void>}
 */
async function batchOperation(logger, objectName, operationType, operationArray, pageSize = 400) {
    // 判断 operationType 是否为 batchCreate 或 batchUpdate 或 batchDelete 其中一种，如果不是则直接返回
    if (['batchCreate', 'batchUpdate', 'batchDelete'].indexOf(operationType) === -1) {
        logger.info(`❌ ${operationType} 不是一个有效的操作类型，无法执行`);
        return;
    }
    // 判断 operationArray 是否为数组，如果不是则直接返回
    if (!Array.isArray(operationArray)) {
        logger.info(`❌ ${operationArray} 不是一个有效的数组，无法执行`);
        return;
    }
    // 判断 operationArray 的长度是否大于 0，如果不是则直接返回
    if (operationArray.length === 0) {
        logger.info(`❌ ${operationType} 传入数组的长度为 0，无法执行`);
        return;
    }
    // 对 operationArray 进行分页操作
    let pageNum = Math.ceil(operationArray.length / pageSize);
    for (let i = 0; i < pageNum; i++) {
        let records = operationArray.slice(i * pageSize, (i + 1) * pageSize);
        await application.data.object(objectName)[operationType](records);
    }
}

/**
 * @description 根据用户ID获取用户邮箱
 * @param {*} userIdList
 * @returns
 */
async function fetchEmailsByUserId(userIdList) {
    const { tenantAccessToken } = await application.integration.getDefaultTenantAccessToken();

    // Split the userIdList into chunks of 50
    const chunkArray = (array, size) => {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    };
    const MAX_USERS_PER_REQUEST = 50;
    const chunks = chunkArray(userIdList, MAX_USERS_PER_REQUEST);
    const config = {
        method: 'get',
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${tenantAccessToken}`,
        },
    };

    const requests = chunks.map(chunk => {
        const url = `https://open.feishu.cn/open-apis/contact/v3/users/batch?user_id_type=user_id&${chunk.map(userId => `user_ids=${userId}`).join('&')}`;
        return axios.request({ ...config, url });
    });

    try {
        const responses = await Promise.all(requests);
        const emails = responses.flatMap(response => response.data.data.items.map(item => item.email));
        return emails;
    } catch (error) {
        console.error('Error fetching user data:', error.response?.data || error.message);
        throw error; // Or handle it as you deem appropriate
    }
}

/**
 * @description 根据部门ID获取部门信息
 * @param {*} department_id
 * @returns
 */
async function fetchDepartmentInfoById(client, department_id) {
    let response = await client.contact.department.get({
        path: { department_id },
        params: {
            user_id_type: 'open_id',
            department_id_type: 'open_department_id',
        },
    });

    return response.data.department;
}

// 分块数组
const chunkArray = (array, chunkSize = 200) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
};

/**
 * @description 根据userId获取用户手机号
 * @param {@} client
 * @param {*} user_id
 */
async function fetchUserMobilePhoneById(user_id) {
    const { appId } = await application.integration.getDefaultTenantAccessToken();

    const client = new lark.Client({ appId, appSecret: 'fake' });

    let response = await client.contact.user.get({
        path: { user_id },
        params: {
            user_id_type: 'user_id',
        },
    });

    return response.data.user.mobile;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 并发限制参数
const limitPerSecond = 15;        // 每秒限制的最大并发数
const windowDuration = 1;        // 时间窗口为1秒
const maxRetries = 5;            // 最大重试次数
const baseRetryDelay = 500;      // 重试的基础延迟（毫秒）

// 初始化令牌桶，如果不存在则创建
async function refillTokens(key, limit) {
    // 当前秒级时间戳
    const now = Math.floor(Date.now() / 1000);
    const tokenKey = `${key}:tokens`;
    const timestampKey = `${key}:timestamp`;

    const lastRefillTime = await baas.redis.get(timestampKey);

    if (!lastRefillTime || parseInt(lastRefillTime) < now) {
        // 令牌桶初始化，设置过期时间为 1 秒
        await baas.redis.set(tokenKey, limit, 'EX', windowDuration);
        await baas.redis.set(timestampKey, now, 'EX', windowDuration);
    }
}

// 获取令牌，成功则返回 true，失败返回 false
async function acquireToken(key) {
    const tokenKey = `${key}:tokens`;

    const tokensLeft = await baas.redis.decr(tokenKey);

    if (tokensLeft >= 0) {
        return true;
    } else {
        // 如果没有令牌可用，则回滚计数
        await baas.redis.incr(tokenKey);
        return false;
    }
}

// 带重试机制的限流器包装函数
async function limitedFunctionWithRetry(key, logger ,fn, retryCount = 0) {
    // 填充令牌
    await refillTokens(key, limitPerSecond);

    const allowed = await acquireToken(key);

    if (allowed) {
        try {
            // 执行任务
            const result = await fn();
            return {
                code: 400,
                msg: result
            };
        } catch (err) {
            logger.warn('任务执行出错:', err);
            return null;
        }
    } else {
        // 如果未获取到令牌，检查是否需要重试
        if (retryCount < maxRetries) {
            // 指数退避
            const delay = baseRetryDelay * Math.pow(2, retryCount);
            logger.log(`未获取到令牌，等待 ${delay} 毫秒后重试 (第 ${retryCount + 1} 次)`);
            // 等待一段时间
            await sleep(delay);
            // 递归重试
            return limitedFunctionWithRetry(key,logger, fn, retryCount + 1);
        } else {
            logger.warn('重试次数达到上限，任务被放弃');
            return {
                code: 400,
                msg: '重试次数达到上限，任务被放弃'
            };
        }
    }
}

module.exports = {
    createLarkClient,
    newLarkClient,
    createLimiter,
    getUserIdByEmails,
    getOpenIdByEmailsOrMobiles,
    getaPaaSUser,
    getaPaaSUsers,
    getUserByOpenId,
    getUsersByOpenId,
    batchOperation,
    fetchEmailsByUserId,
    fetchDepartmentInfoById,
    chunkArray,
    fetchUserMobilePhoneById,
    sleep,
    limitedFunctionWithRetry,
};
