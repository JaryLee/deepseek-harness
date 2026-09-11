/** `desktopNotify` namespace dictionaries: the settings card and the notices. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'desktopNotify'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': '桌面通知',
  'card.description': '会话结束时提醒你，需要你回答时也提醒你。',
  'field.enabled': '启用通知',
  'field.enabled.hint': '关闭后，桌面通知与页面内的鲸鱼提示都不再出现。',
  'field.onlyWhenHidden': '仅在页面隐藏时用系统通知',
  'field.onlyWhenHidden.hint': '关闭后，页面在前台时除了鲸鱼提示，还会弹一条系统通知。',
  'field.onQuestion': '会话提问时提醒',
  'field.onQuestion.hint': '会话向你提问、请求授权或提交计划待审时提醒。',
  'field.sound': '播放提示音',
  'field.sound.hint': '页面在前台时播放鲸鱼跃出水面的提示音；浏览器允许播放声音后才有效。',
  'permission.label': '系统通知权限',
  'permission.granted': '已允许',
  'permission.denied': '已拒绝',
  'permission.default': '尚未选择',
  'permission.unsupported': '当前环境不支持',
  'permission.request': '请求权限',
  'permission.hint': '浏览器只在点击后授权；若已拒绝，请在地址栏的站点设置里重新允许。',
  'notify.finished': '会话已完成',
  'notify.waitingTitle': '会话在等你',
  'notify.waitingAnswer': '向你提出了一个问题',
  'notify.waitingApproval': '请求你的授权',
  'notify.waitingPlan': '提交了待审的计划',
  'notice.open': '打开会话',
  'notice.dismiss': '关闭提示',
} satisfies Record<string, string>

/** The `desktopNotify` namespace key union. */
export type DesktopNotifyKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Desktop notifications',
  'card.description': 'Tell me when a session finishes, and when it needs my answer.',
  'field.enabled': 'Enable notifications',
  'field.enabled.hint': 'Off hides both the OS notification and the in-page whale notice.',
  'field.onlyWhenHidden': 'System notification only while the page is hidden',
  'field.onlyWhenHidden.hint': 'Off also raises a system notification while the page is in front.',
  'field.onQuestion': 'Notify when a session asks me something',
  'field.onQuestion.hint': 'Covers questions, approval requests, and plans submitted for review.',
  'field.sound': 'Play the sound',
  'field.sound.hint': 'Plays the whale-call cue while the page is in front; needs audio the browser lets a page play.',
  'permission.label': 'System notification permission',
  'permission.granted': 'Allowed',
  'permission.denied': 'Denied',
  'permission.default': 'Not chosen yet',
  'permission.unsupported': 'Unsupported here',
  'permission.request': 'Request permission',
  'permission.hint': 'Browsers grant this only from a click; after a denial, allow it again in the site settings.',
  'notify.finished': 'Session finished',
  'notify.waitingTitle': 'A session is waiting for you',
  'notify.waitingAnswer': 'asked you a question',
  'notify.waitingApproval': 'requested your approval',
  'notify.waitingPlan': 'submitted a plan for review',
  'notice.open': 'Open the session',
  'notice.dismiss': 'Dismiss the notice',
} satisfies Record<DesktopNotifyKey, string>
