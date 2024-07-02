// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const axios = require('axios');
const {newLarkClient} = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date()} 获取部门人员函数开始执行：`, params);

    const client = await newLarkClient({userId: context.user._id}, logger);
    // logger.info('Lark 客户端初始化完成', client);
    // 获取 token
    let appToken = await baas.redis.get("appToken");

    const clientId = await application.globalVar.getVar("clientId");
    const clientSecret = await application.globalVar.getVar("clientSecret");
    // 调用飞书查询直属部门下成员列表
    const getDepUserList = async (pageToken, externalOpenDepartmentId) => {
        const depUserList = [];
        try {
            const depUserRes = await client.contact.user.findByDepartment({
                params: {
                    page_token: pageToken,
                    department_id: externalOpenDepartmentId,
                },
            })

            if (depUserRes.code !== 0) {
                throw new Error("获取群成员接口报错", error);
            }

            logger.info('获取部门成员列表：', depUserRes)
            depUserList.push(...depUserRes.data.items);

            // 如果还有数据，则采用递归
            if (!depUserRes.data.has_more) {
                return depUserList;
            }
            const moreDepUserList = await getDepUserList(depUserRes.data.page_token, externalOpenDepartmentId);
            depUserList.push(...moreDepUserList);

            return depUserList;
        } catch (error) {
            logger.error("获取群成员接口报错", error);
            throw new Error("获取群成员接口报错", error);
        }
    }

    // 通过接口调用获取 token
    if (!appToken) {
        if (!clientId || !clientSecret) {
            logger.info("请配置 clientId 和 clientSecret")
            return {code: -1, msg: "请配置 clientId 和 clientSecret"}
        }
        let data = JSON.stringify({
            clientId,
            clientSecret
        });
        logger.info('调用获取 token 接口入参：', data);
        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://ae-openapi.feishu.cn/auth/v1/appToken',
            headers: {
                'Content-Type': 'application/json'
            },
            data: data
        };

        await axios.request(config)
            .then(async (response) => {
                if (response.data) {
                    logger.info('调用获取 token 接口成功：', response.data)

                    appToken = response.data.data.accessToken;
                    const tokenLiveTime = response.data.data.expireTime;
                    const currentTime = Date.now(); // 获取当前时间戳
                    const fifteenMinutesInMillis = 900000; // 15分钟转换为毫秒

                    // 计算剩余时间
                    const remainingTime = (tokenLiveTime - currentTime - fifteenMinutesInMillis) / 1000;
                    await baas.redis.setex("appToken", remainingTime, appToken)
                }
            })
            .catch((error) => {
                logger.info('调用获取 token 接口失败：', error)
                return {code: -1, msg: "调用获取 token 接口失败"}
            });
    }
    // 调用获取部门 id 的接口
    let getDepIdData = JSON.stringify({
        "department_id_type": "department_id",
        "department_ids": [(params.dep._id || params.dep.id).toString()]
    });

    let getDepConfig = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://ae-openapi.feishu.cn/api/integration/v2/feishu/getDepartments',
        headers: {
            'Authorization': appToken,
            'Content-Type': 'application/json'
        },
        data: getDepIdData
    };

    // let externalDepartmentId;
    let externalOpenDepartmentId; //od-c247f42f5e027ffd7abc3709cdf379b3
    await axios.request(getDepConfig)
        .then(async (response) => {
            logger.info('调用获取部门 id 接口成功：', response.data)
            if (response.data.code === '0') {
                let depData = response.data.data[0];
                // externalDepartmentId = depData.external_department_id;
                externalOpenDepartmentId = depData.external_open_department_id;
            }
        })
        .catch((error) => {
            logger.info('调用获取部门 id 接口失败：', error);
            return {code: -1, msg: "获取部门 id 失败"}
        });

    if (!externalOpenDepartmentId) {
        return {code: -1, msg: "获取部门 id 失败"}
    }
    let depUserRes = [];
    if (externalOpenDepartmentId) {
        depUserRes = await getDepUserList('', externalOpenDepartmentId);
    }
    // logger.info('获取部门成员列表：', depUserRes)
    // 将飞书的部门成员（用户）转换为 apaas 用户
    let depMemberList = [];
    for (let depUser of depUserRes) {
        await application.data
            .object('_user')
            .select(['_email', '_id','_phoneNumber'])
            .where({ _phoneNumber: application.operator.contain(depUser.mobile.substring(3))})
            .findStream(records => {
                depMemberList.push(...records);
            });
    }
    logger.info('获取部门成员列表：', depMemberList)
    return {depMemberList};
    // 在这里补充业务代码
}
