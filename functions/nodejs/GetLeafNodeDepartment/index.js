// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 获取数据库中的数据信息
  const apaas_dep_records = [];

  // 获取所有部门信息
  await application.data
    .object("_department")
    .select(["_id", "_name", "_superior"])
    .findStream(records => {
      apaas_dep_records.push(...records);
    });

  let isLeafNode = true;
  for (const dep of apaas_dep_records) {
    if (dep._superior && params.depId == dep._superior._id) {
      isLeafNode = false;
    }
  }
  return isLeafNode
}