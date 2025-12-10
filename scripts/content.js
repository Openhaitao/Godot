// Content Script - 在所有网页中运行，监听快捷键和显示输入框

let promptBox = null;

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showPromptBox') {
    showPromptBox();
    sendResponse({ success: true });
  }
});

// 监听快捷键（备用方案，主要通过 manifest commands）
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+G (所有平台统一使用 Ctrl)
  if (e.ctrlKey && e.shiftKey && e.key === 'G') {
    e.preventDefault();
    showPromptBox();
  }
});

function showPromptBox() {
  // 如果已经存在，先移除
  if (promptBox) {
    promptBox.remove();
  }

  // 获取当前选中的文本
  const selectedText = window.getSelection().toString().trim();

  // 创建浮层容器
  promptBox = document.createElement('div');
  promptBox.className = 'ai-prompt-overlay';
  promptBox.innerHTML = `
    <div class="ai-prompt-box">
      <div class="ai-prompt-header">
        <h3>🚀 推送到 AI</h3>
        <button class="ai-prompt-close" id="closeBtn">×</button>
      </div>
      
      <div class="ai-prompt-body">
        <div class="ai-prompt-section">
          <label>选中的文本：</label>
          <div class="ai-selected-text">${selectedText || '（未选中任何文本）'}</div>
        </div>
        
        <div class="ai-prompt-section">
          <label>你的提示词：</label>
          <textarea 
            id="userPrompt" 
            placeholder="输入你想让 AI 做的事情，例如：\n- 总结这段文字\n- 翻译成英文\n- 帮我分析一下\n- 给出建议"
            rows="4"
          ></textarea>
        </div>
        
        <div class="ai-prompt-section">
          <label>推送到：</label>
          <div class="ai-target-buttons">
            <button class="ai-btn ai-btn-gemini" id="sendToGemini">
              <span class="ai-btn-icon">✨</span>
              发送到 Gemini
            </button>
            <button class="ai-btn ai-btn-chatgpt" id="sendToChatGPT">
              <span class="ai-btn-icon">💬</span>
              发送到 ChatGPT
            </button>
          </div>
        </div>
      </div>
      
      <div class="ai-prompt-footer">
        <small>提示：每次发送都会自动创建新对话，可继续工作，稍后查看结果</small>
      </div>
    </div>
  `;

  document.body.appendChild(promptBox);

  // 聚焦到输入框
  const textarea = promptBox.querySelector('#userPrompt');
  setTimeout(() => textarea.focus(), 100);

  // 绑定事件
  promptBox.querySelector('#closeBtn').addEventListener('click', closePromptBox);
  promptBox.querySelector('#sendToGemini').addEventListener('click', () => sendToAI('gemini', selectedText));
  promptBox.querySelector('#sendToChatGPT').addEventListener('click', () => sendToAI('chatgpt', selectedText));

  // 点击遮罩层关闭
  promptBox.addEventListener('click', (e) => {
    if (e.target === promptBox) {
      closePromptBox();
    }
  });

  // ESC 键关闭
  document.addEventListener('keydown', handleEscKey);
}

function handleEscKey(e) {
  if (e.key === 'Escape') {
    closePromptBox();
  }
}

function closePromptBox() {
  if (promptBox) {
    promptBox.remove();
    promptBox = null;
  }
  document.removeEventListener('keydown', handleEscKey);
}

function sendToAI(target, selectedText) {
  const userPrompt = promptBox.querySelector('#userPrompt').value.trim();

  if (!userPrompt) {
    alert('请输入提示词！');
    return;
  }

  // 检查扩展上下文是否有效
  if (!chrome.runtime?.id) {
    alert('扩展已更新或重新加载，请刷新此页面后重试！\n\n按 F5 或 Ctrl+R (Mac: Cmd+R) 刷新页面。');
    return;
  }

  // 构建完整的消息
  let fullMessage = userPrompt;
  if (selectedText) {
    fullMessage += '\n\n---\n选中的文本：\n' + selectedText;
  }

  // 显示发送中状态
  const btn = target === 'gemini' 
    ? promptBox.querySelector('#sendToGemini')
    : promptBox.querySelector('#sendToChatGPT');
  
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="ai-btn-icon">⏳</span> 发送中...';
  btn.disabled = true;

  // 发送消息到 background script
  try {
    chrome.runtime.sendMessage({
      action: 'sendToAI',
      target: target,
      message: fullMessage
    }, (response) => {
      // 检查是否有运行时错误
      if (chrome.runtime.lastError) {
        console.error('Runtime error:', chrome.runtime.lastError);
        alert('扩展连接失败，请刷新此页面后重试！\n\n错误：' + chrome.runtime.lastError.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }

      if (response && response.success) {
        // 显示成功提示
        btn.innerHTML = '<span class="ai-btn-icon">✓</span> 已发送！';
        btn.style.backgroundColor = '#10b981';
        
        // 2秒后关闭
        setTimeout(() => {
          closePromptBox();
        }, 1500);
      } else {
        // 失败提示
        alert('发送失败：' + (response?.error || '未知错误'));
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  } catch (error) {
    console.error('Send error:', error);
    alert('扩展已更新或重新加载，请刷新此页面后重试！\n\n按 F5 或 Ctrl+R (Mac: Cmd+R) 刷新页面。');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

