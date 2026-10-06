// 励磁强励次数的判定标准。换版 = 改这里的 version 与阈值，
// 下次进入系统时检测到已算版本不一致，自动按新版重算全部已有记录。
export const EXCITATION_STANDARD = {
  version: '2026版',
  /** 强励次数达到该值评为「关注」 */
  attention: 3,
  /** 强励次数达到该值评为「异常」 */
  abnormal: 5,
} as const

export type ExcitationLevel = '正常' | '关注' | '异常'

export function evaluateExcitation(count: number): ExcitationLevel {
  if (count >= EXCITATION_STANDARD.abnormal) {
    return '异常'
  }
  if (count >= EXCITATION_STANDARD.attention) {
    return '关注'
  }
  return '正常'
}
