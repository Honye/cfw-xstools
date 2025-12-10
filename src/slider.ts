import { Buffer } from 'node:buffer'
import { Jimp, intToRGBA } from 'jimp'

/**
 * 针对半透明遮罩+边缘噪点优化的滑块识别
 * @param bgBase64 背景图
 * @param sliderBase64 滑块图 (仅用于获取宽高)
 * @param sliderY 已知的 Y 轴
 */
export async function findGapWithHighAccuracy(bgBase64: string, sliderBase64: string, sliderY: number) {
  // 1. 读取并预处理图片

  const bgImg = await Jimp.read(
    Buffer.from(bgBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"),
  );
  const sliderImg = await Jimp.read(
    Buffer.from(sliderBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"),
  );

  // 转灰度，极大降低计算量并聚焦亮度信息
  bgImg.greyscale();

  const { width: bgW, height: bgH } = bgImg.bitmap;
  const { width: sW, height: sH } = sliderImg.bitmap;

  // 扫描范围配置
  const startX = sW + 5; // 跳过左侧，通常缺口不会紧贴着起始位
  const endX = bgW - sW - 5;

  // 核心变量：记录每一列的“边缘得分”
  let maxScore = -1;
  let bestX = 0;

  // 2. 开始 X 轴扫描
  for (let x = startX; x < endX; x++) {
    let currentColumnScore = 0;

    // 3. 垂直方向累积 (积分思维)
    // 这一步能有效过滤掉“随机加上去的几个灰色像素点”
    for (let y = sliderY; y < sliderY + sH; y++) {
      // 防止越界
      if (y >= bgH) continue;

      // 获取前一列像素亮度 (x-1) 和当前列像素亮度 (x)
      // 因为已经 grayscale，取 r, g, b 任意一个通道即代表亮度
      const prevPixel = intToRGBA(bgImg.getPixelColor(x - 1, y)).r;
      const currPixel = intToRGBA(bgImg.getPixelColor(x, y)).r;

      // 计算亮度下降幅度 (前一列 - 当前列)
      // 如果是缺口左边缘，prevPixel 会比 currPixel 亮很多，diff 为正大数
      // 如果是噪点，diff 可能很小或者为负
      const diff = prevPixel - currPixel;

      // 只有当亮度明显下降时才计入得分 (过滤掉杂乱波动)
      if (diff > 15) {
        currentColumnScore += diff;
      }
    }

    // 4. 判定最佳位置
    // currentColumnScore 越高，说明这一列整体发生的“变暗”程度最剧烈
    if (currentColumnScore > maxScore) {
      maxScore = currentColumnScore;
      bestX = x;
    }
  }

  // console.log(`[高精度模式] 识别结果 X: ${bestX}, 最大边缘得分: ${maxScore}`);

  // 修正：通常检测到的是边缘突变的那一列，有时需要微调 2-3 像素
  return bestX;
}

export const handler: ExportedHandlerFetchHandler<Env> = async (req, env, ctx) => {
	const { method } = req
	if (method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405 })
	}
	const { bgBase64, sliderBase64, sliderY } = await req.json() as any
	if (!bgBase64) return new Response('Missing Parameter `bgBase64`', { status: 400 })
	if (!sliderBase64) return new Response('Missing Parameter `sliderBase64`', { status: 400 })
	if (!sliderY) return new Response('Missing Parameter `sliderY`', { status: 400 })

	const x = await findGapWithHighAccuracy(bgBase64, sliderBase64, sliderY)

	return Response.json({ x }, { status: 200 })
}

export default handler
