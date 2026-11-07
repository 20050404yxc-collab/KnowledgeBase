// 文件：ui_navigation.mjs
// 层：桌面验证辅助
// 作用：通过实际侧栏和知识库页内入口切换页面。
// 说明：仅使用测试窗口的可见控件，不修改 React 内部状态。

// 频率分区先进入知识库；避免测试依赖已移除的顶层分区按钮。
export async function navigateUi(ui, section) {
  if (['常用', '在学', '归档'].includes(section)) {
    const hasViews = await ui.evaluate(`!!document.querySelector('.library-view')`)
    if (!hasViews) {
      await navigateUi(ui, '知识库')
    }
  }
  await ui.evaluate(`(() => {
    const name = ${JSON.stringify(section)};
    const selector = ['常用', '在学', '归档'].includes(name) ? '.library-view' : '.nav-item';
    const target = [...document.querySelectorAll(selector)].find(button =>
      selector === '.library-view' ? button.textContent.trim() === name : button.textContent.trim().endsWith(name));
    if (!target) throw Error('Missing navigation: ' + name);
    target.click();
  })()`)
}
