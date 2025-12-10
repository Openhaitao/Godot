// Background Service Worker - 处理任务调度和标签页管理

// 监听快捷键命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'trigger-ai-prompt') {
    triggerPromptBox();
  }
});

// 触发当前标签页显示提示框
async function triggerPromptBox() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'showPromptBox' });
  }
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendToAI') {
    handleSendToAI(request.target, request.message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启，用于异步响应
  }
});

// 处理发送到 AI 的逻辑
async function handleSendToAI(target, message) {
  try {
    const targetUrl = target === 'gemini' 
      ? 'https://gemini.google.com/app'
      : 'https://chatgpt.com/';

    // 查找是否已经打开了目标页面
    const tabs = await chrome.tabs.query({ url: targetUrl + '*' });
    
    let targetTab;
    if (tabs.length > 0) {
      // 如果已经打开，使用现有标签页
      targetTab = tabs[0];
      console.log('找到已存在的标签页:', targetTab.id);
      // 不需要等待加载，因为页面已经存在
    } else {
      // 如果没有打开，创建新标签页（在后台打开）
      targetTab = await chrome.tabs.create({
        url: targetUrl,
        active: false // 后台打开，不打断用户
      });
      console.log('创建新标签页:', targetTab.id);
      
      // 等待页面加载完成
      await waitForTabLoad(targetTab.id);
    }

    // 注入脚本：先创建新对话，再发送消息
    await injectAndSend(targetTab.id, target, message);

    return { success: true, tabId: targetTab.id };
  } catch (error) {
    console.error('发送失败:', error);
    return { success: false, error: error.message };
  }
}

// 等待标签页加载完成
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('页面加载超时'));
    }, 30000); // 30秒超时

    function checkStatus() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (tab.status === 'complete') {
          clearTimeout(timeout);
          // 额外等待一点时间，确保页面 JavaScript 初始化完成
          setTimeout(resolve, 2000);
        } else {
          setTimeout(checkStatus, 500);
        }
      });
    }

    checkStatus();
  });
}

// 注入脚本并发送消息
async function injectAndSend(tabId, target, message) {
  // 根据目标选择不同的注入脚本
  const injectionCode = target === 'gemini' 
    ? getGeminiInjectionCode(message)
    : getChatGPTInjectionCode(message);

  // 执行注入脚本
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: injectionCode.func,
    args: [message]
  });

  console.log('消息已注入到标签页:', tabId);
}

// Gemini 注入代码
function getGeminiInjectionCode(message) {
  return {
    func: (msg) => {
      // 这个函数会在 Gemini 页面的上下文中执行
      
      // 第一步：点击"新建聊天"按钮
      function clickNewChat() {
        // Gemini 的新建聊天按钮选择器
        const newChatSelectors = [
          'button[aria-label*="New chat"]',
          'button[aria-label*="新对话"]',
          'button[aria-label*="新建"]',
          'a[href="/app"]', // Gemini 的主页链接
          'button[mattooltip*="New"]',
          'button.new-chat-button'
        ];

        for (const selector of newChatSelectors) {
          const buttons = document.querySelectorAll(selector);
          for (const btn of buttons) {
            if (btn.offsetParent !== null) {
              console.log('找到新建聊天按钮，点击中...');
              btn.click();
              return true;
            }
          }
        }
        
        console.log('未找到新建聊天按钮，将在当前对话中发送');
        return false;
      }
      
      // 第二步：等待并查找输入框的函数
      function findAndFillInput() {
        // Gemini 的输入框通常是一个带有 contenteditable 的 div 或 textarea
        // 尝试多种选择器
        const selectors = [
          'div.ql-editor[contenteditable="true"]',
          'textarea[placeholder*="Enter"]',
          'div[contenteditable="true"][role="textbox"]',
          'textarea',
          'div.ql-editor'
        ];

        let inputElement = null;
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            // 确保元素可见且可编辑
            if (el.offsetParent !== null) {
              inputElement = el;
              break;
            }
          }
          if (inputElement) break;
        }

        if (!inputElement) {
          console.error('未找到输入框');
          return false;
        }

        // 填充内容
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          inputElement.value = msg;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // contenteditable div
          inputElement.textContent = msg;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 触发焦点
        inputElement.focus();

        // 等待一小会儿，然后查找并点击发送按钮
        setTimeout(() => {
          // 查找发送按钮
          const buttonSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="发送"]',
            'button[title*="Send"]',
            'button svg[viewBox*="24"]', // 常见的发送图标
            'button.send-button',
            'button[type="submit"]'
          ];

          let sendButton = null;
          for (const selector of buttonSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const btn of buttons) {
              if (btn.offsetParent !== null && !btn.disabled) {
                sendButton = btn;
                break;
              }
            }
            if (sendButton) break;
          }

          if (sendButton) {
            sendButton.click();
            console.log('已点击发送按钮');
          } else {
            console.log('未找到发送按钮，请手动点击发送');
          }
        }, 500);

        return true;
      }

      // 执行流程：先点击新建聊天，等待后再填充内容
      console.log('开始执行：创建新对话并发送消息');
      
      // 点击新建聊天
      clickNewChat();
      
      // 等待新对话界面加载，然后填充内容
      let attempts = 0;
      const maxAttempts = 10;
      
      function tryFill() {
        attempts++;
        if (findAndFillInput()) {
          console.log('成功填充内容');
        } else if (attempts < maxAttempts) {
          console.log(`尝试 ${attempts}/${maxAttempts}...`);
          setTimeout(tryFill, 1000);
        } else {
          console.error('多次尝试后仍未找到输入框');
        }
      }
      
      // 延迟1秒后开始尝试填充（给新对话界面加载时间）
      setTimeout(tryFill, 1000);
    }
  };
}

// ChatGPT 注入代码
function getChatGPTInjectionCode(message) {
  return {
    func: (msg) => {
      // 这个函数会在 ChatGPT 页面的上下文中执行
      
      // 第一步：点击"新建聊天"按钮
      function clickNewChat() {
        // ChatGPT 的新建聊天按钮选择器
        const newChatSelectors = [
          'a[href="/"]', // ChatGPT 主页链接
          'button[aria-label*="New chat"]',
          'button[aria-label*="新对话"]',
          'a.flex.items-center[href="/"]', // 新版 ChatGPT
          'nav a[href="/"]',
          'button.new-chat-button'
        ];

        for (const selector of newChatSelectors) {
          const elements = document.querySelectorAll(selector);
          // 找到包含 "New chat" 或图标的按钮
          for (const el of elements) {
            const text = el.textContent?.toLowerCase() || '';
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
            
            if ((text.includes('new chat') || text.includes('新') || ariaLabel.includes('new')) 
                && el.offsetParent !== null) {
              console.log('找到新建聊天按钮，点击中...');
              el.click();
              return true;
            }
          }
        }
        
        // 尝试点击侧边栏的 ChatGPT 标志或首页链接
        const logoLinks = document.querySelectorAll('a[href="/"], a[href="/?model=gpt-4"]');
        if (logoLinks.length > 0 && logoLinks[0].offsetParent !== null) {
          console.log('通过首页链接创建新对话...');
          logoLinks[0].click();
          return true;
        }
        
        console.log('未找到新建聊天按钮，将在当前对话中发送');
        return false;
      }
      
      // 第二步：填充输入框并发送
      function findAndFillInput() {
        // ChatGPT 的输入框
        const selectors = [
          '#prompt-textarea',
          'textarea[placeholder*="Message"]',
          'textarea[data-id*="prompt"]',
          'div[contenteditable="true"]',
          'textarea'
        ];

        let inputElement = null;
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (el.offsetParent !== null) {
              inputElement = el;
              break;
            }
          }
          if (inputElement) break;
        }

        if (!inputElement) {
          console.error('未找到输入框');
          return false;
        }

        // 填充内容
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          // 使用 React 的方式更新值
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
          ).set;
          nativeInputValueSetter.call(inputElement, msg);
          
          // 触发事件
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          inputElement.textContent = msg;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }

        inputElement.focus();

        // 查找并点击发送按钮
        setTimeout(() => {
          const buttonSelectors = [
            'button[data-testid="send-button"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="发送"]',
            'button svg[viewBox="0 0 32 32"]', // ChatGPT 的发送图标
            'button[type="submit"]'
          ];

          let sendButton = null;
          for (const selector of buttonSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const btn of buttons) {
              if (btn.offsetParent !== null && !btn.disabled) {
                sendButton = btn;
                break;
              }
            }
            if (sendButton) break;
          }

          if (sendButton) {
            sendButton.click();
            console.log('已点击发送按钮');
          } else {
            console.log('未找到发送按钮，请手动点击发送');
          }
        }, 500);

        return true;
      }

      // 执行流程：先点击新建聊天，等待后再填充内容
      console.log('开始执行：创建新对话并发送消息');
      
      // 点击新建聊天
      clickNewChat();
      
      // 等待新对话界面加载，然后填充内容
      let attempts = 0;
      const maxAttempts = 10;
      
      function tryFill() {
        attempts++;
        if (findAndFillInput()) {
          console.log('成功填充内容');
        } else if (attempts < maxAttempts) {
          console.log(`尝试 ${attempts}/${maxAttempts}...`);
          setTimeout(tryFill, 1000);
        } else {
          console.error('多次尝试后仍未找到输入框');
        }
      }
      
      // 延迟1秒后开始尝试填充（给新对话界面加载时间）
      setTimeout(tryFill, 1000);
    }
  };
}

