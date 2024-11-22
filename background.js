chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyzeImage",
    title: "Analyze with Gemini",
    contexts: ["image"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyzeImage") {
    analyzeImage(info.srcUrl);
  }
});

async function analyzeImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    
    const result = await sendToGemini(base64);
    // Send result to popup
    chrome.runtime.sendMessage({ type: 'analysisResult', result });
  } catch (error) {
    console.error('Error analyzing image:', error);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendToGemini(base64Image) {
  const API_KEY = 'AIzaSyBoKzwUFlqFJd4B7VK3Xg9i8D37-0wdLP0';
  const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent';

  const requestBody = {
    contents: [{
      parts: [{
        text: "Describe this image in detail:",
      }, {
        inline_data: {
          mime_type: "image/jpeg",
          data: base64Image
        }
      }]
    }]
  };

  const response = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
} 