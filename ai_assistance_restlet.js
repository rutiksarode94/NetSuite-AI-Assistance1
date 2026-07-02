/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define([
    'N/https', 
    'N/log', 
    'N/record', 
    'N/url', 
    'N/search', 
    'N/runtime'
], (
    https, 
    log, 
    record, 
    url, 
    search, 
    runtime
) => {

    const post = (requestBody) => {
        try {
            const { sessionId, message } = requestBody;

            if (!sessionId || !message) {
                return { success: false, error: "Missing sessionId or message" };
            }

            const pythonUrl = 'https://netsuite-ai-assistance-1.onrender.com/chat';

            var aiResult = {};
            try{
                const pyResponse = https.post({
                    url: pythonUrl,
                    body: JSON.stringify({ sessionId, message }),
                    headers: { 'Content-Type': 'application/json' }
                });

                aiResult = JSON.parse(pyResponse.body);
                log.debug('AI Result from Python', aiResult);
            } catch (e) {
                log.error('Python Request Failed', e.message);
                saveChatMessage(sessionId, 'assistant', "Failed to communicate with AI service");
                return { success: false, error: "Failed to communicate with AI service" };
            }

            if (!aiResult.success) {
                throw new Error(aiResult.error || 'AI request failed');
            }

            let finalResponse = aiResult.response || '';
            const operationResults = [];

            let actions = aiResult.action;
            if (!Array.isArray(actions)) {
                actions = actions ? [actions] : [];
            }

            for (let action of actions) {
                const result = executeAction(action);
                if (result && result.success) {
                    operationResults.push(result);
                }
            }

            if (operationResults.length > 0) {
                finalResponse += `\n\n📋 **Operation Results:**\n`;
                
                operationResults.forEach((res, index) => {
                    if (res.operation === 'create') {
                        finalResponse += `\n${index + 1}. **${res.recordtype.toUpperCase()} Created**\n` +
                                       `Internal ID: ${res.internalId}\n` +
                                       `🔗 Link: ${res.fullLink}\n`;
                    } 
                    else if (res.operation === 'search') {
                        finalResponse += `\n${index + 1}. **${res.recordtype.toUpperCase()} Search**\n` +
                                       `Search Name: ${res.searchName}\n` +
                                       `🔗 View Saved Search: ${res.searchLink}\n` +
                                       `Total Records: ${res.count}\n\n`;
                    }
                });
            }

            // saveChatMessage(sessionId, 'user', message);
            saveChatMessage(sessionId, 'assistant', finalResponse);

            return {
                success: true,
                response: finalResponse,
                results: operationResults
            };

        } catch (e) {
            log.error('RESTlet Error', e);
            return { success: false, error: e.message || "Failed to process request" };
        }
    };

    function executeAction(action) {
        try {
            if (!action?.type) return null;

            switch (action.type) {
                case 'create_record':
                    return createRecord(action.data);
                case 'search_record':
                    return searchRecord(action.data);
                default:
                    log.error('Unknown action type', action.type);
                    return null;
            }
        } catch (e) {
            log.error('Execute Action Failed', e);
            return null;
        }
    }

    // function createRecord(data) {
    //     const { recordtype, fields = {} } = data;
    //     if (!recordtype) return { success: false };

    //     try {
    //         const rec = record.create({ type: recordtype, isDynamic: false });

    //         Object.keys(fields).forEach(fieldId => {
    //             try {
    //                 rec.setValue({ fieldId: fieldId, value: fields[fieldId] });
    //             } catch (err) {}
    //         });

    //         const internalId = rec.save({
    //             enableSourcing: true,
    //             ignoreMandatoryFields: true
    //         });

    //         const accountId = runtime.accountId;
    //         const fullLink = `https://${accountId}.app.netsuite.com/app/common/entity/custjob.nl?id=${internalId}&compid=${accountId}`;

    //         return {
    //             success: true,
    //             operation: 'create',
    //             recordtype: recordtype,
    //             internalId: internalId,
    //             fullLink: fullLink
    //         };
    //     } catch (e) {
    //         log.error('Create Record Failed', e);
    //         return { success: false };
    //     }
    // }

    function createRecord(data) {
        const accountId = runtime.accountId;
        const { recordtype, fields = {} } = data;
        if (!recordtype) return { success: false };

        try {
            const rec = record.create({ type: recordtype, isDynamic: true });

            Object.keys(fields).forEach(fieldId => {
                let value = fields[fieldId];

                try {
                    // Convert common string boolean values
                    if (typeof value === 'string') {
                        const lower = value.toLowerCase().trim();
                        if (lower === 't' || lower === 'true' || lower === 'yes' || lower === 'y') {
                            value = true;
                        } else if (lower === 'f' || lower === 'false' || lower === 'no' || lower === 'n') {
                            value = false;
                        }
                    }

                    rec.setValue({ fieldId: fieldId, value: value });
                } catch (err) {
                    log.debug(`Skipped field ${fieldId}`, err.message);
                }
            });

            const internalId = rec.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            const fullLink = `https://${accountId}.app.netsuite.com` + 
            url.resolveRecord({
                recordType: recordtype,
                recordId: internalId,
                isEditMode: false
            });

            return {
                success: true,
                operation: 'create',
                recordtype: recordtype,
                internalId: internalId,
                fullLink: fullLink
            };
        } catch (e) {
            log.error('Create Record Failed', e);
            return { success: false, error: e.message };
        }
    }

    // function searchRecord(data) {
    //     const { recordtype, filters = [], searchname = "AI Search" } = data;
    //     if (!recordtype) return { success: false };

    //     try {
    //         const accountId = runtime.accountId;

    //         // Create Saved Search with safe columns
    //         const savedSearch = search.create({
    //             type: recordtype,
    //             title: `${searchname} - ${new Date().toISOString().slice(0,16)}`,
    //             filters: filters,
    //             columns: ['internalid']   // Safe minimal column
    //         });

    //         const searchId = savedSearch.save();

    //         const searchLink = `https://${accountId}.app.netsuite.com/app/common/search/savedsearchresults.nl?searchid=${searchId}&whence=`;

    //         // Get count
    //         const pagedData = search.create({
    //             type: recordtype,
    //             filters: filters,
    //             columns: ['internalid']
    //         }).runPaged({ pageSize: 1 });

    //         return {
    //             success: true,
    //             operation: 'search',
    //             recordtype: recordtype,
    //             searchName: savedSearch.title,
    //             searchId: searchId,
    //             count: pagedData.count || 0,
    //             searchLink: searchLink
    //         };
    //     } catch (e) {
    //         log.error('Create Saved Search Failed', e);
    //         const accountId = runtime.accountId;
    //         return {
    //             success: true,
    //             operation: 'search',
    //             recordtype: recordtype || 'record',
    //             searchName: "Quick Search",
    //             searchId: null,
    //             count: 0,
    //             searchLink: `https://${accountId}.app.netsuite.com/app/common/search/savedsearchresults.nl?searchtype=${recordtype || 'customer'}`
    //         };
    //     }
    // }
function searchRecord(data) {
    const { recordtype, searchtype, filters = [], columns = [], searchname = "AI Search" } = data;
    if (!recordtype) return { success: false };

    // "searchtype" is the value the AI generated specifically for search.create({type}).
    // It is NOT the same as "recordtype" (e.g. items must use "item", not "noninventoryitem").
    // Fall back to recordtype only if the AI omitted searchtype (e.g. custom records).
    const effectiveSearchType = searchtype || recordtype;

    // Columns must come from the AI response — never hardcode to just internalid.
    const effectiveColumns = (Array.isArray(columns) && columns.length > 0)
        ? columns
        : ['internalid'];

    try {
        const accountId = runtime.accountId;

        const savedSearch = search.create({
            type: effectiveSearchType,
            title: `${searchname} - ${new Date().toISOString().slice(0,16)}`,
            filters: filters,
            columns: effectiveColumns
        });

        const searchId = savedSearch.save();

        const searchLink = `https://${accountId}.app.netsuite.com/app/common/search/savedsearchresults.nl?searchid=${searchId}&whence=`;

        // Get an actual result count instead of hardcoding 0
        let resultCount = 0;
        try {
            resultCount = search.load({ id: searchId }).runPaged({ pageSize: 1000 }).count;
        } catch (countErr) {
            log.debug('Count Lookup Failed', countErr.message);
        }

        return {
            success: true,
            operation: 'search',
            recordtype: recordtype,
            searchtype: effectiveSearchType,
            searchName: savedSearch.title,
            searchId: searchId,
            count: resultCount,
            searchLink: searchLink,
            columns: effectiveColumns
        };
    } catch (e) {
        log.error('Saved Search Failed - Using SuiteQL from AI', e.message);
        return executeSuiteQL(data);
    }
}

// Execute SuiteQL Query from AI
function executeSuiteQL(data) {
    const { recordtype, searchtype, searchname = "AI Search", query } = data;
    const accountId = runtime.accountId;
    const effectiveSearchType = searchtype || recordtype;

    try {
        log.debug('Executing SuiteQL', query);
        // Fallback query, if the AI didn't provide one, must use the "item" table for item
        // searchtypes (matches the SuiteQL rules in the system prompt) instead of recordtype.
        const fallbackTable = effectiveSearchType === 'item' ? 'item'
            : effectiveSearchType === 'transaction' ? 'transaction'
            : effectiveSearchType;
        let sql = query || `SELECT id, ${fallbackTable === 'item' ? 'itemid, displayname' : 'entityid'} FROM ${fallbackTable} WHERE isinactive = 'F' LIMIT 50`;

        const suiteQLResult = search.create({
            type: search.Type.FREEFORM,
            query: sql
        }).run();

        log.debug('SuiteQL ResultSet', suiteQLResult);
        const results = suiteQLResult.getRange({ start: 0, end: 50 });

        // Read whichever columns actually came back from the query, instead of
        // hardcoding a fixed field name — the SELECT list is fully dynamic from the AI.
        const columnNames = suiteQLResult.columns.map(c => c.name);

        const searchLink = `https://${accountId}.app.netsuite.com/app/common/search/savedsearchresults.nl?searchtype=${effectiveSearchType}`;

        return {
            success: true,
            operation: 'search',
            recordtype: recordtype,
            searchtype: effectiveSearchType,
            searchName: searchname + " (SuiteQL)",
            searchId: null,
            count: results.length,
            searchLink: searchLink,
            results: results.map(r => {
                const row = { id: r.id };
                columnNames.forEach(col => {
                    row[col] = r.getValue({ name: col });
                });
                return row;
            })
        };
    } catch (e) {
        log.error('SuiteQL Execution Failed', e);
        const accountId = runtime.accountId;
        return {
            success: true,
            operation: 'search',
            recordtype: recordtype,
            searchName: "Quick Search",
            searchId: null,
            count: 0,
            searchLink: `https://${accountId}.app.netsuite.com/app/common/search/searchresults.nl?searchtype=${recordtype}`
        };
    }
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

    return { post: post };
});