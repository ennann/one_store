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

  logger.info('批量插入或者创建时的入参：', params);
  if (!params.department_name) {
      logger.error("传入的部门名称为空");
      return {department: {}}
  }
  // 有可能传入的部门数据为 ”飞书有限公司/深圳/深圳龙华门店“
  const departmentName = params.department_name;
  const departmentArray = departmentName.split('/');
  // 在这里补充业务代码

  if (departmentArray.length === 1) {
      const department = await application.data.object('_department').select('_name', '_manager', '_id').where({"_name": params.department_name}).findOne();

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
          if (dep._superior && department._id == dep._superior._id) {
              isLeafNode = false;
          }
      }
      // 如果是叶子节点部门返回部门，否则返回空
      if (isLeafNode) {
          return {department};
      }
  } else if (departmentArray.length > 1) {
      let departmentList = [];

      // 获取门店的信息
      await application.data
          .object('_department')
          .select('_name', '_manager', '_id', '_superior')
          .where({"_name": departmentArray[departmentArray.length - 1]})
          .findStream(async (records) => departmentList.push(...records));

      // 若不存在则返回空部门信息，
      if (departmentList.length === 0) {
          return {department: {}}
      } else if (departmentList.length === 1) {
          // 若只存在一个返回当前查询到的部门
          return {department: departmentList[0]};
      } else {
          // 若存在多个在递归查询
          // return getMoreLevelDepMsg(departmentList,departmentArray);
          let dep2 = [];

          // 若存在多个则再去查上一级部门
          await application.data
              .object('_department')
              .select('_name', '_manager', '_id', '_superior')
              .where({"_name": departmentArray[departmentArray.length - 2]})
              .findStream(async (records) => dep2.push(...records));
          // 若只返回一个二级部门，对比一下三级部门与二级部门的关系
          if (dep2.length === 1) {
              for (const item of departmentList) {
                  if (item._superior.id === dep2[0]._id) {
                      return {department: item}
                  }
              }
          } else if(dep2.length > 1) {
              // 若存在多个二级部门，查3级部门
              let dep3 = [];
              await application.data
                  .object('_department')
                  .select('_name', '_manager', '_id', '_superior')
                  .where({"_name": departmentArray[departmentArray.length - 3]})
                  .findStream(async (records) => dep3.push(...records));

              // 遍历二级部门,确认指定的二级部门
              let confirmDep2;

              for (const item of dep2) {
                  if (item._superior.id === dep3[0]._id) {
                      confirmDep2 = item;
                  }
              }
              // 确认一级部门
              for (const item of departmentList) {
                  if (item._superior.id === confirmDep2._id) {
                      return {department: item}
                  }
              }
          }
      }
  }

  return {department: {}}
}
