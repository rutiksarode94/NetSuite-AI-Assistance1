/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/redirect', 'N/url', 'N/log', 'N/https'], 
(serverWidget, search, record, runtime, redirect, url, log, https) => 
{
    const onRequest = (context) => {
        const request = context.request;
        let currentSessionId = request.parameters.sessionid || '';

        if (request.method === 'POST') {
            const action = request.parameters.action || '';

            if (action === 'newchat') {
                currentSessionId = createNewChat();
            } else if (action === 'deletechat') {
                deleteChat(request.parameters.sessionid);
            } else if (action === 'renamechat') {
                renameChat(request.parameters.sessionid, request.parameters.title);
            } else if (action === 'sendmessage') {
                currentSessionId = handleSendMessage(request);
            }

            redirect.toSuitelet({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                parameters: { sessionid: currentSessionId }
            });
            return;
        }

        const sessions = getSessions();
        if (!currentSessionId && sessions.length > 0) {
            currentSessionId = sessions[0].id;
        }

        const messages = currentSessionId ? getChatMessages(currentSessionId) : [];

        const htmlContent = getFullHtml(sessions, currentSessionId, messages);
        context.response.write(htmlContent);
    };

    // function createNewChat() {
    //     const currentUser = runtime.getCurrentUser();
    //     const sessionRec = record.create({ type: 'customrecord_ai_chat_session' });
    //     sessionRec.setValue({ fieldId: 'custrecord_ai_chat_title', value: 'New Chat' });
    //     sessionRec.setValue({ fieldId: 'custrecord_ai_user', value: currentUser.id });
    //     sessionRec.setValue({ fieldId: 'custrecord_ai_active', value: true });
    //     sessionRec.setValue({ fieldId: 'custrecord_ai_last_updated_session', value: new Date() });
    //     return sessionRec.save();
    // }

    function handleSendMessage(request) {
        const sessionId = request.parameters.sessionid;
        const userMessage = request.parameters.message?.trim();

        if (!sessionId || !userMessage) return sessionId;

        saveChatMessage(sessionId, 'user', userMessage);

        try {
            const response = https.requestRestlet({
                scriptId: 'customscript_ai_assistance_restlet',           // Your Restlet Script ID
                deploymentId: 'customdeploy_ai_assistance_restlet',          // Your Restlet Deployment ID
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sessionId,
                    message: userMessage
                })
            });

            const aiResult = JSON.parse(response.body);
            const aiResponse = (aiResult.success && aiResult.response) 
                ? aiResult.response 
                : "Sorry, I couldn't process that right now.";

            // saveChatMessage(sessionId, 'assistant', aiResponse);

        } catch (e) {
            log.error('Restlet Call Failed', e);
            saveChatMessage(sessionId, 'assistant', "Sorry, AI is currently unavailable.");
        }

        return sessionId;
    }

    function saveChatMessage(sessionId, role, messageText) {
        try {
            const msgRec = record.create({ type: 'customrecord_ai_chat_message' });
            msgRec.setValue({ fieldId: 'custrecord_ai_session', value: sessionId });
            msgRec.setValue({ fieldId: 'custrecord_ai_role', value: role });
            msgRec.setValue({ fieldId: 'custrecord_ai_chat_message', value: messageText });
            msgRec.setValue({ fieldId: 'custrecord_ai_chat_msg_timestamp', value: new Date() });
            msgRec.setValue({ fieldId: 'custrecord_ai_msg_sequence', value: new Date().getTime() });
            msgRec.save();
        } catch (e) {
            log.error('Save Message Failed', e);
        }
    }

    function deleteChat(sessionId) {
        if (!sessionId) return;
        try { record.delete({ type: 'customrecord_ai_chat_session', id: sessionId }); } catch(e){}
    }

    function renameChat(sessionId, newTitle) {
        if (!sessionId || !newTitle?.trim()) return;
        try {
            const rec = record.load({ type: 'customrecord_ai_chat_session', id: sessionId });
            rec.setValue({ fieldId: 'custrecord_ai_chat_title', value: newTitle.trim() });
            rec.setValue({ fieldId: 'custrecord_ai_last_updated_session', value: new Date() });
            rec.save();
        } catch(e){}
    }

    // function getSessions() {
    //     const sessions = [];
    //     search.create({
    //         type: 'customrecord_ai_chat_session',
    //         columns: ['custrecord_ai_chat_title', 'custrecord_ai_last_updated_session'],
    //         sort: { column: 'custrecord_ai_last_updated_session', sort: search.Sort.DESC }
    //     }).run().each(result => {
    //         sessions.push({ id: result.id, title: result.getValue('custrecord_ai_chat_title') || 'New Chat' });
    //         return true;
    //     });
    //     return sessions;
    // }

    // function getChatMessages(sessionId) {
    //     if (!sessionId) return [];
    //     const messages = [];
    //     search.create({
    //         type: 'customrecord_ai_chat_message',
    //         filters: ['custrecord_ai_session', 'is', sessionId],
    //         columns: ['custrecord_ai_role', 'custrecord_ai_chat_message'],
    //         sort: { column: 'custrecord_ai_msg_sequence', sort: search.Sort.ASC }
    //     }).run().each(result => {
    //         messages.push({
    //             role: result.getValue('custrecord_ai_role') || 'assistant',
    //             message: result.getValue('custrecord_ai_chat_message') || ''
    //         });
    //         return true;
    //     });
    //     return messages;
    // }

    function createNewChat() {
        const currentUser = runtime.getCurrentUser();
        const sessionRec = record.create({ type: 'customrecord_ai_chat_session' });
        sessionRec.setValue({ fieldId: 'custrecord_ai_chat_title', value: 'New Chat' });
        sessionRec.setValue({ fieldId: 'custrecord_ai_user', value: currentUser.id });        // ← Important
        sessionRec.setValue({ fieldId: 'custrecord_ai_active', value: true });
        sessionRec.setValue({ fieldId: 'custrecord_ai_last_updated_session', value: new Date() });
        return sessionRec.save();
    }

    function getSessions() {
        const currentUser = runtime.getCurrentUser();
        const sessions = [];
        search.create({
            type: 'customrecord_ai_chat_session',
            filters: [
                ['custrecord_ai_user', 'is', currentUser.id]     // ← Filter by current user
            ],
            columns: ['custrecord_ai_chat_title', 'custrecord_ai_last_updated_session'],
            sort: { column: 'custrecord_ai_last_updated_session', sort: search.Sort.DESC }
        }).run().each(result => {
            sessions.push({ 
                id: result.id, 
                title: result.getValue('custrecord_ai_chat_title') || 'New Chat' 
            });
            return true;
        });
        return sessions;
    }

    function getChatMessages(sessionId) {
        if (!sessionId) return [];
        const messages = [];
        search.create({
            type: 'customrecord_ai_chat_message',
            filters: [
                ['custrecord_ai_session', 'is', sessionId]
                // Optionally add user check here too
            ],
            columns: ['custrecord_ai_role', 'custrecord_ai_chat_message'],
            sort: { column: 'custrecord_ai_msg_sequence', sort: search.Sort.ASC }
        }).run().each(result => {
            messages.push({
                role: result.getValue('custrecord_ai_role') || 'assistant',
                message: result.getValue('custrecord_ai_chat_message') || ''
            });
            return true;
        });
        return messages;
    }

    function getFullHtml(sessions, currentSessionId, messages) {
        let sidebarHtml = '';
        sessions.forEach(session => {
            const isActive = session.id === currentSessionId;
            sidebarHtml += `
                <div class="chat-item ${isActive ? 'active' : ''}" data-id="${session.id}" onclick="loadChat('${session.id}')">
                    <span class="chat-title">${session.title}</span>
                    <div class="menu-wrapper">
                        <button type="button" class="menu-btn" onclick="event.stopImmediatePropagation(); toggleMenu(event, 'menu_${session.id}')">⋮</button>
                        <div id="menu_${session.id}" class="dropdown-menu">
                            <div onclick="event.stopImmediatePropagation(); renameChat('${session.id}')">Rename</div>
                            <div onclick="event.stopImmediatePropagation(); deleteChat('${session.id}')">Delete</div>
                        </div>
                    </div>
                </div>`;
        });

        // ✅ Clickable Links for both Record & Search
        let messagesHtml = messages.length === 0 
            ? `<div class="assistant-msg"><div class="msg">Start chatting...</div></div>`
            : messages.map(msg => {
                let text = msg.message
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    // Make all links clickable
                    .replace(/(https:\/\/[^\s]+)/g, 
                        '<a href="$1" target="_blank" style="color:#0066cc; text-decoration:underline; font-weight:bold;">$1</a>');

                return `
                    <div class="${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}">
                        <div class="msg">${text}</div>
                    </div>`;
            }).join('');

        const suiteletUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
            returnExternalUrl: false
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>NetSuite AI Assistant</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;}
        .container{display:flex;height:90vh;}
        .sidebar{width:280px;border-right:1px solid #ddd;padding:15px;background:#f8f9fa;}
        .new-chat-btn{width:100%;padding:12px;margin-bottom:20px;background:#007bff;color:white;border:none;border-radius:6px;cursor:pointer;}
        .chat-list{display:flex;flex-direction:column;gap:8px;}
        .chat-item{display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;}
        .chat-item:hover{background:#e9ecef;}
        .chat-item.active{background:#d7ebff;border-color:#007bff;}
        .menu-btn{background:none;border:none;font-size:18px;cursor:pointer;padding:5px;}
        .dropdown-menu{display:none;position:absolute;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,0.2);z-index:1000;width:130px;}
        .dropdown-menu div{padding:10px;cursor:pointer;}
        .dropdown-menu div:hover{background:#f5f5f5;}
        .main-chat{flex:1;display:flex;flex-direction:column;}
        .messages{flex:1;padding:20px;overflow:auto;background:#f8f9fa;}
        .user-msg{text-align:right;margin-bottom:15px;}
        .assistant-msg{text-align:left;margin-bottom:15px;}
        .msg{display:inline-block;padding:12px 16px;border-radius:12px;max-width:80%;}
        .user-msg .msg{background:#007bff;color:white;}
        .assistant-msg .msg{background:#fff;border:1px solid #ddd;}
        .input-section{display:flex;padding:15px;border-top:1px solid #ddd;gap:10px;}
        .input-section textarea{flex:1;padding:12px;resize:none;height:70px;border-radius:6px;border:1px solid #ccc;}
    </style>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <button type="button" class="new-chat-btn" onclick="createNewChat()">+ New Chat</button>
            <div class="chat-list">${sidebarHtml}</div>
        </div>

        <div class="main-chat">
            <div class="messages" id="messages">
                ${messagesHtml}
            </div>

            <div class="input-section">
                <textarea id="messageBox" placeholder="Ask NetSuite AI Assistant..."></textarea>
                <button type="button" onclick="sendMessage()">Send</button>
            </div>
        </div>
    </div>

    <form id="actionForm" method="POST" style="display:none;">
        <input type="hidden" id="action" name="action">
        <input type="hidden" id="sessionid" name="sessionid">
        <input type="hidden" id="message" name="message">
        <input type="hidden" id="title" name="title">
    </form>

    <script>
        let currentSessionId = "${currentSessionId}";
        const baseUrl = "${suiteletUrl}";

        function loadChat(sessionId) {
            window.location.href = baseUrl + "&sessionid=" + encodeURIComponent(sessionId);
        }

        window.createNewChat = function() {
            document.getElementById('action').value = 'newchat';
            document.getElementById('actionForm').submit();
        };

        window.sendMessage = function() {
            const msg = document.getElementById('messageBox').value.trim();
            if (!msg || !currentSessionId) return;

            document.getElementById('action').value = 'sendmessage';
            document.getElementById('sessionid').value = currentSessionId;
            document.getElementById('message').value = msg;
            document.getElementById('actionForm').submit();
            document.getElementById('messageBox').value = '';
        };

        window.toggleMenu = function(event, id) {
            event.stopImmediatePropagation();
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            const menu = document.getElementById(id);
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        };

        window.renameChat = function(sessionId) {
            const newTitle = prompt("Enter new chat title:");
            if (!newTitle || !newTitle.trim()) return;
            document.getElementById('action').value = 'renamechat';
            document.getElementById('sessionid').value = sessionId;
            document.getElementById('title').value = newTitle.trim();
            document.getElementById('actionForm').submit();
        };

        window.deleteChat = function(sessionId) {
            if (!confirm('Delete this chat?')) return;
            document.getElementById('action').value = 'deletechat';
            document.getElementById('sessionid').value = sessionId;
            document.getElementById('actionForm').submit();
        };

        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-menu').forEach(menu => menu.style.display = 'none');
        });
    </script>
</body>
</html>`;
    }

    return { onRequest };
});