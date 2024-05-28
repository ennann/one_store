// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter } = require('../utils');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  logger.info(`根据消息定义生成消息卡片内容函数开始执行`, params);
  // https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json#45e0953e
  // https://open.feishu.cn/document/server-docs/im-v1/message/create?appId=cli_a68809f3b7f9500d

  const { record } = params;

  const client = await newLarkClient({ userId: context.user._id }, logger);

  // 获取图片image_key
  const getImgKey = async (token) => {
    const file = await application.resources.file.download(token);
    try {
      const imageKeyRes = await client.im.image.create({
        data: {
          image_type: 'message',
          image: file,
        },
      });
      return imageKeyRes.image_key;
    } catch (error) {
      logger.error("上传图片失败", error);
      throw new Error("上传图片失败", error);
    }
  };

  // 获取多张图片image_key
  const getImageKeys = async (images) => {
    const limitUploadImg = createLimiter(getImgKey);
    const imgUploadList = await Promise.all(images.map(item => limitUploadImg(item.token)));
    return imgUploadList.filter(imgKey => !!imgKey);
  };

  // 图片类型根据图片数量返回消息数据
  const getImgContent = async () => {
    if (!record.images || record.images.length === 0) {
      logger.error("消息定义没有图片");
      return [];
    }
    const imageKeys = await getImageKeys(record.images);
    if (imageKeys.length === 1) {
      return {
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKeys[0] })
      };
    }
    // 多张图片使用消息卡片模板类型
    const elements = getCardImgElement(imageKeys);
    let info = { elements };
    if (record.message_title) {
      info = {
        ...info,
        header: {
          template: "turquoise",
          title: {
            tag: "plain_text",
            content: record.message_title,
          }
        },
      }
    }
    logger.info(`最终生成的消息内容为`, {
      msg_type: "interactive",
      content: JSON.stringify(info)
    });

    return {
      msg_type: "interactive",
      content: JSON.stringify(info)
    };
  }

  // 转换富文本-飞书卡片类型
  const formatRichToCard = async (htmlString, title) => {
    const divs = [];
    const elements = [];
    let match;
    const imgRegex = /<img[^>]*src="([^"]*)"[^>]*>/g;
    const divRegex = /<div[^>]*>\s*([\s\S]*?)\s*<\/div>/gs;
    const _htmlString = htmlString.replace(/<div[^>]*><\/div>/g, '');

    while ((match = divRegex.exec(_htmlString)) !== null && !!match[1]) {
      divs.push(match[1]);
    }

    for (const div of divs) {
      const imgs = [];
      imgRegex.lastIndex = 0;
      // 图片
      while ((match = imgRegex.exec(div)) !== null) {
        const imgDiv = match[0];
        const srcMatch = imgDiv.match(/src="([^"]*)"/);
        const urlParams = new URLSearchParams(srcMatch[1].split('?')[1]);
        const token = urlParams.get('token');
        imgs.push({ token });
      }
      if (imgs.length > 0) {
        const imgKeys = await getImageKeys(imgs);
        const imgElement = getCardImgElement(imgKeys);
        elements.push(...imgElement);
      }
      if ((match = imgRegex.exec(div)) === null) {
        const content = transformText(div);
        let textItem = {
          tag: "markdown",
          content
        };
        const text_align = getTextAlignValue(div);
        const text_size = getFontSizeValue(div);
        if (text_align) {
          textItem = { ...textItem, text_align };
        }
        if (text_size) {
          textItem = { ...textItem, text_size };
        }
        elements.push(textItem);
      }
    }
    let info = { elements };
    if (title) {
      info = {
        ...info,
        header: {
          template: "turquoise",
          title: {
            tag: "plain_text",
            content: title,
          }
        },
      }
    }
    return info;
  };

  // 获取消息内容
  const getContent = async (type) => {
    switch (type) {
      // 富文本类型消息
      case 'option_rich_text':
        const postData = await formatRichToCard(record.message_richtext.raw, record.message_title);
        return {
          msg_type: "interactive",
          content: JSON.stringify(postData)
        };
      // 视频类型消息直接发成文本类型
      case 'option_video':
        const textObj = {
          text: `${record.message_title ?? ''}\n\n${record.video_url}`
        }
        return {
          msg_type: "text",
          content: JSON.stringify(textObj)
        };
      // 消息卡片模板类型消息
      case 'option_card':
        const data = {
          type: 'template',
          data: {
            template_id: record.message_template_id,
          }
        };
        return {
          msg_type: "interactive",
          content: JSON.stringify(data)
        };
      // 图片类型消息
      default:
        const res = await getImgContent();
        return res;
    };
  }

  try {
    if (!record.option_message_type) {
      logger.error("缺少消息类型");
      throw new Error("缺少消息类型");
    }
    const content = await getContent(record.option_message_type)
    const receive_id_type = record.send_channel === "option_group" ? "chat_id" : "user_id";
    return {
      ...content,
      receive_id_type
    };
  } catch (error) {
    logger.error("生成内容失败", error);
    throw new Error("生成内容失败", error);
  }
};

// 获取飞书卡片的图片布局信息
const getCardImgElement = (imageKeys) => {
  // 先分列，三图一列
  const imageKeyList = splitArray(imageKeys);
  const list = imageKeyList.reduce((pre, imageKeys) => {
    const columns = imageKeys.map(img_key => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [
        {
          img_key,
          tag: "img",
          mode: "fit_horizontal",
          preview: true,
          alt: {
            content: "",
            tag: "plain_text"
          },
        }
      ]
    }));
    const elements = {
      tag: "column_set",
      background_style: "default",
      horizontal_spacing: "default",
      columns,
      flex_mode: imageKeys.length === 1
        ? "none"
        : [2, 4].includes(imageKeys.length)
          ? "bisect"
          : "trisect",
    };
    return [
      ...pre,
      elements
    ];
  }, []);
  return list;
};

const replaceTag = str => str.replace(/<(?!\/?font\b)[^>]*>/g, '');

const transformText = (html) => {
  const htmlString = parseMarkdown(html);
  return replaceTag(htmlString);
};

const parseMarkdown = (text) => {
  const tagRegex = /<([a-z]+)[^>]*>(.*?)<\/\1>/g;

  const tagHandlers = {
    a: (match, content) => {
      const url = match.match(/href="(.*?)"/)[1];
      return "[" + parseMarkdown(content) + "](" + url + ")";
    },
    b: (match, content) => "**" + parseMarkdown(content) + "**",
    i: (match, content) => "*" + parseMarkdown(content) + "*",
    s: (match, content) => "~~" + parseMarkdown(content) + "~~",
    span: (match, content) => {
      const color = getColorValue(match);
      if (color) {
        return "<font color='" + color + "'>" + parseMarkdown(testTag(content)) + "</font>";
      }
      return parseMarkdown(content);
    },
  };

  return text.replace(tagRegex, (match, tagName, content) => {
    return tagHandlers[tagName] ? tagHandlers[tagName](match, content) : content;
  });
};

const testTag = (text) => {
  let str = text;
  if (text.includes("<i>")) {
    str = `*${str}*`
  }
  if (text.includes("<s>")) {
    str = `~~${str}~~`
  }
  return str;
}

const splitArray = (arr, size = 3) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

const getTextAlignValue = (str) => {
  const textAlignPattern = /text-align:\s*([^;]+);/;
  const match = textAlignPattern.exec(str);
  return match ? match[1] : null;
};

const getFontSizeValue = (str) => {
  const fontSizePattern = /font-size:\s*(\d+)px;/;
  const match = str.match(fontSizePattern);
  return match ? TextSizeEnum[match[1]] ?? "medium" : null;
};

const getColorValue = text => {
  const colorRegex = /color:\s*([^;]+)\s*;/;
  const match = text.match(colorRegex);
  return match ? ColorEnum[match[1]] : null;
};

const TextSizeEnum = {
  30: "xxxx-large",
  24: "xxx-large",
  20: "xx-large",
  18: "x-large",
  16: "large",
  14: "medium",
  12: "small",
  10: "x-small"
};

// 匹配飞书消息卡片的枚举值
// https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/enumerations-for-fields-related-to-color
const ColorEnum = {
  // 黑灰白
  "rgb(255, 255, 255)": "bg-white",
  "rgb(242, 243, 245": "grey-100",
  "rgb(222, 224, 227)": "grey-300",
  "rgb(143, 149, 158)": "grey-500",
  "rgb(55, 60, 67)": "grey-700",
  "rgb(0, 0, 0)": "grey-1000",
  // 蓝色
  "rgb(51, 112, 255)": "blue-400",
  "rgb(240, 244, 255)": "blue-50",
  "rgb(186, 206, 253)": "blue-200",
  "rgb(78, 131, 253)": "blue-500",
  "rgb(36, 91, 219)": "blue-350",
  "rgb(12, 41, 110)": "blue-900",
  // 绿色
  "rgb(52, 199, 36)": "green-350",
  "rgb(240, 251, 239)": "green-50",
  "rgb(183, 237, 177)": "green-100",
  "rgb(98, 210, 86)": "green-700",
  "rgb(46, 161, 33)": "green-500",
  "rgb(18, 75, 12)": "green-800",
  // 紫色
  "rgb(127, 59, 245)": "purple-600",
  "rgb(246, 241, 254)": "purple-50",
  "rgb(205, 178, 250)": "purple-300",
  "rgb(147, 90, 246)": "purple-600",
  "rgb(100, 37, 208)": "purple-700",
  "rgb(39, 5, 97)": "purple-900",
  // 黄色
  "rgb(255, 198, 10)": "yellow-350",
  "rgb(253, 249, 237)": "yellow-50",
  "rgb(248, 230, 171)": "yellow-100",
  "rgb(250, 211, 85)": "yellow-300",
  "rgb(220, 155, 4)": "yellow-400",
  "rgb(92, 58, 0)": "yellow-800",

  // 红色
  "rgb(245, 74, 69)": "red-400",
  "rgb(254, 241, 241)": "red-50",
  "rgb(251, 191, 188)": "red-200",
  "rgb(247, 105, 100)": "red-350",
  "rgb(216, 57, 49)": "red-500",
  "rgb(98, 28, 24)": "red-800",
};