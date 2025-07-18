/*
 * AiStreamingPanel.java
 *
 * Copyright (C) 2025 by William Nickols
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 */

package org.rstudio.studio.client.workbench.views.ai.widgets;

import com.google.gwt.user.client.ui.*;
import com.google.gwt.dom.client.Element;
import com.google.gwt.dom.client.Document;
import com.google.gwt.safehtml.shared.SafeHtml;
import com.google.gwt.safehtml.shared.SafeHtmlBuilder;
import com.google.gwt.safehtml.shared.SafeHtmlUtils;
import com.google.gwt.core.client.Scheduler;
import com.google.gwt.core.client.Scheduler.RepeatingCommand;
import org.rstudio.studio.client.workbench.views.ai.events.AiStreamDataEvent;
import org.rstudio.studio.client.workbench.views.ai.events.AiStartConversationEvent;
import org.rstudio.studio.client.application.events.EventBus;
import org.rstudio.core.client.Markdown;
import org.rstudio.core.client.CommandWithArg;
import com.google.gwt.resources.client.ClientBundle;
import com.google.gwt.resources.client.CssResource;
import com.google.gwt.core.client.GWT;
import org.rstudio.core.client.Debug;
import org.rstudio.studio.client.workbench.views.ai.AiScrollManager;

import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;
import org.rstudio.studio.client.workbench.views.ai.AiTerminalWidget;
import org.rstudio.studio.client.workbench.views.ai.AiPane;
import java.util.Date;
import java.util.List;
import java.util.ArrayList;

public class AiStreamingPanel extends HTML implements AiStreamDataEvent.Handler, AiStartConversationEvent.Handler
{
   /**
    * Class to represent a queued event waiting for its sequence number
    */
   private static class QueuedEvent
   {
      final String type;
      final AiStreamDataEvent streamEvent;
      final String operationType;
      final String messageId;
      final String command;
      final String explanation;
      final String requestId;
      final String filename;
      final String content;
      final boolean skipDiffHighlighting;
      final com.google.gwt.core.client.JavaScriptObject diffData;
      
      // Constructor for stream events
      QueuedEvent(AiStreamDataEvent event)
      {
         this.type = "stream";
         this.streamEvent = event;
         this.operationType = null;
         this.messageId = event.getMessageId();
         this.command = null;
         this.explanation = null;
         this.requestId = null;
         this.filename = null;
         this.content = null;
         this.skipDiffHighlighting = false;
         this.diffData = null;
      }
      
      // Constructor for operation events
      QueuedEvent(String operationType, String messageId, String command, String explanation, String requestId, String filename, String content, boolean skipDiffHighlighting, com.google.gwt.core.client.JavaScriptObject diffData)
      {
         this.type = "operation";
         this.streamEvent = null;
         this.operationType = operationType;
         this.messageId = messageId;
         this.command = command;
         this.explanation = explanation;
         this.requestId = requestId;
         this.filename = filename;
         this.content = content;
         this.skipDiffHighlighting = skipDiffHighlighting;
         this.diffData = diffData;
      }
   }

   public interface Styles extends CssResource
   {
      String aiStreamingPanel();
      String message();
      String userMessage();
      String assistantMessage();
      String messageContent();
      String streamingContent();
      String contentDelta();
      String typingIndicator();
      
      // Console widget styles
      String aiConsoleWidget();
      String aiConsoleExplanation();
      String aiConsoleEditorContainer();
      String aiConsolePrompt();
      String aiConsoleEditor();
      String aiConsoleButtons();
      String aiConsoleRunButton();
      String aiConsoleCancelButton();
      String consoleCommand();
      String consoleWidgetContainer();
      
      // Terminal widget styles
      String aiTerminalWidget();
      String aiTerminalExplanation();
      String aiTerminalPanel();
      String aiTerminalPrompt();
      String aiTerminalEditor();
      String aiTerminalButtons();
      String aiTerminalRunButton();
      String aiTerminalCancelButton();
      String terminalCommand();
      String terminalWidgetContainer();
      
      // Edit file widget styles
      String aiEditFilePanel();
      String aiEditFileExplanation();
      String aiEditFileEditor();
      String aiEditFileButtons();
      String aiEditFileAcceptButton();
      String aiEditFileCancelButton();
      String editFileCommand();
      String editFileWidgetContainer();
   }

   public interface Resources extends ClientBundle
   {
      @Source("AiStreamingPanel.css")
      Styles styles();
   }

   private static final Resources RES = GWT.create(Resources.class);
   private static final Styles styles_ = RES.styles();
   static { RES.styles().ensureInjected(); }

   public AiStreamingPanel(EventBus eventBus)
   {
      eventBus_ = eventBus;
      streamingMessages_ = new HashMap<>();
      consoleWidgets_ = new HashMap<>();
      terminalWidgets_ = new HashMap<>();
      editFileWidgets_ = new HashMap<>();
      editFileStreamingContent_ = new HashMap<>();
      
      // Initialize per-conversation sequence tracking
      conversationSequences_ = new HashMap<>();
      currentConversationId_ = -1;
      expectedSequence_ = 1;
      eventBuffer_ = new TreeMap<>();
      
      // Initialize function call buffering
      functionCallBuffer_ = new ArrayList<>();
      processingFunctionCall_ = false;
      currentFunctionCallMessageId_ = null;
      
      // Note: Streaming events now use the main sequence system instead of per-message tracking
      
      // Register for streaming events
      eventBus_.addHandler(AiStreamDataEvent.TYPE, this);
      eventBus_.addHandler(AiStartConversationEvent.TYPE, this);
      
      // Initialize with conversation display HTML structure and CSS
      initializeConversationDisplay();
      
      // Initialize scroll manager
      scrollManager_ = new AiScrollManager(this);
   }
   
   /**
    * Initialize the conversation display with proper HTML structure and styling
    */
   private void initializeConversationDisplay()
   {
      SafeHtmlBuilder htmlBuilder = new SafeHtmlBuilder();
      // Only apply styles to the streaming panel container, not global body
      htmlBuilder.appendHtmlConstant("<style>");
      htmlBuilder.appendHtmlConstant(".ai-streaming-panel { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; margin: 12px; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".message { padding: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; font-size: 14px; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".user { background-color: #e6e6e6; border-radius: 5px; display: inline-block; float: right; max-width: 100%; word-wrap: break-word; margin-bottom: 16px; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".assistant { background-color: transparent; text-align: left; word-wrap: break-word; max-width: 100%; position: relative; clear: both; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }"); // Ensure assistant starts below user
      htmlBuilder.appendHtmlConstant(".user-container { width: 100%; overflow: hidden; text-align: right; position: relative; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; font-size: 14px; line-height: 1.4; white-space: pre-wrap; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".text.markdown-content { white-space: normal; }"); // Override pre-wrap for markdown content
      htmlBuilder.appendHtmlConstant(".user { text-align: right; position: relative; }");
      htmlBuilder.appendHtmlConstant(".assistant { text-align: left; }");
      htmlBuilder.appendHtmlConstant(".user .text { text-align: left; max-width: 100%; }");

      htmlBuilder.appendHtmlConstant("@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }");
      htmlBuilder.appendHtmlConstant(".markdown-content { margin-top: 0; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }"); // Ensure markdown content starts at top of assistant message
      htmlBuilder.appendHtmlConstant(".markdown-content h1, .markdown-content h2, .markdown-content h3 { margin-top: 0.75em; margin-bottom: 0.25em; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content p { margin-top: 0.5em; margin-bottom: 0.5em; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content ul, .markdown-content ol { margin-top: 0.5em; margin-bottom: 0.5em; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content li { margin-bottom: 0.25em; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content code { background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content pre { background-color: #f8f8f8; border: 1px solid #ddd; border-radius: 4px; padding: 10px; overflow-x: auto; margin: 0.5em 0; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".markdown-content pre code { background-color: transparent; padding: 0; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".function-call-message { margin-left: 15px; opacity: 0.8; font-size: 14px; color: #666; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant(".ai-streaming-panel *, .message *, .text *, .markdown-content *, .user *, .assistant * { -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; pointer-events: auto !important; }");
      htmlBuilder.appendHtmlConstant("</style>");
      
      // Create the main conversation container with proper ID
      htmlBuilder.appendHtmlConstant("<div id='streaming-conversation' class='ai-streaming-panel'>");
      htmlBuilder.appendHtmlConstant("</div>");
      
      String generatedHtml = htmlBuilder.toSafeHtml().asString();
      
      // Set the HTML content
      setHTML(generatedHtml);
   }
   
   /**
    * Switch to a different conversation, saving current state and loading target state
    * CRITICAL: Each conversation maintains its own sequence tracking
    */
   public void switchToConversation(int conversationId)
   {
      // Determine if this is the same conversation by checking both our internal state
      // and the current URL (which persists across refreshes)
      boolean isSameConversation = isSameConversationId(conversationId);
      
      // Save current conversation's sequence state 
      if (currentConversationId_ != -1) {
         conversationSequences_.put(currentConversationId_, expectedSequence_);
      }
      
      // Load target conversation's sequence state or start at 1
      currentConversationId_ = conversationId;
      Integer savedSequence = conversationSequences_.get(conversationId);
      if (savedSequence != null) {
         expectedSequence_ = savedSequence;
      } else {
         expectedSequence_ = 1;
      }
      
      // Clear buffer to avoid stale events from previous conversation
      eventBuffer_.clear();
      
      // For conversation switches, temporarily disable scroll animations to prevent visible scrolling
      if (!isSameConversation) {
         
         // Clear persistent diff indicators when switching to a different conversation
         // This ensures that diff indicators from the previous conversation don't persist
         // and new indicators will be loaded based on the target conversation's file_changes.json
         clearPersistentDiffIndicators();
         
         // Defer re-initialization until after the R backend conversation switch completes
         // This ensures we load diff data for the correct conversation
         com.google.gwt.core.client.Scheduler.get().scheduleDeferred(new com.google.gwt.core.client.Scheduler.ScheduledCommand() {
            @Override
            public void execute() {
               reinitializePersistentDiffIndicators();
            }
         });
         
         scrollManager_.disableAnimations();
         // Re-enable animations after a short delay
         Scheduler.get().scheduleFixedDelay(new RepeatingCommand() {
            @Override
            public boolean execute() {
               scrollManager_.enableAnimations();
               return false; // Don't repeat
            }
         }, 500); // 500ms delay
      }
   }
   
   /**
    * Check if the given conversation ID represents the same conversation as currently displayed
    * If currentConversationId_ is -1 (after refresh/initialization), treat as different conversation
    */
   private boolean isSameConversationId(int targetConversationId)
   {
      // If we don't have valid current state, treat as different conversation (safer - scroll to bottom)
      if (currentConversationId_ == -1) {
         return false;
      }
      
      boolean isSame = (currentConversationId_ == targetConversationId);
      return isSame;
   }
   
   /**
    * Process a queued event (either stream or operation)
    */
   private void processQueuedEvent(QueuedEvent queuedEvent, int sequence)
   {
      // Set the current processing sequence for DOM ordering
      currentProcessingSequence_ = sequence;
      
      if ("stream".equals(queuedEvent.type))
      {
         processStreamEventSynchronously(queuedEvent.streamEvent);
      }
      else if ("operation".equals(queuedEvent.type))
      {
         processOperationEventSynchronously(queuedEvent);
      }
   }
   
   /**
    * Process buffered events in sequence order
    */
   private void processBufferedEvents()
   {
      while (eventBuffer_.containsKey(expectedSequence_))
      {
         QueuedEvent queuedEvent = eventBuffer_.remove(expectedSequence_);
         processQueuedEvent(queuedEvent, expectedSequence_);
         expectedSequence_++;
      }
   }
   
   /**
    * Add a sequence-ordered operation event to the processing queue
    */
   public void addOperationEvent(int sequence, String operationType, String messageId, String command, String explanation, String requestId, String filename, String content, boolean skipDiffHighlighting, com.google.gwt.core.client.JavaScriptObject diffData)
   {
      QueuedEvent queuedEvent = new QueuedEvent(operationType, messageId, command, explanation, requestId, filename, content, skipDiffHighlighting, diffData);
      
      // Special cases: both start_background_recreation and clear_conversation 
      // always process immediately regardless of sequence because they signal 
      // that R is rebuilding the conversation from scratch
      if ("start_background_recreation".equals(operationType) || "clear_conversation".equals(operationType))
      {
         processQueuedEvent(queuedEvent, sequence);
         // After processing, expect the next sequence
         expectedSequence_ = sequence + 1;
         
         // Process any buffered events that are now ready
         processBufferedEvents();
         return;
      }
      
      if (sequence == expectedSequence_)
      {
         // Process immediately - this is the next expected event
         processQueuedEvent(queuedEvent, sequence);
         expectedSequence_++;
         
         // Process any buffered events that are now ready
         processBufferedEvents();
      }
      else if (sequence > expectedSequence_)
      {
         // Buffer for later - this event arrived early
         eventBuffer_.put(sequence, queuedEvent);
      }
      else
      {
         // This is a late/duplicate event - ignore it
      }
   }
   
   /**
    * Process an operation event synchronously
    */
   private void processOperationEventSynchronously(QueuedEvent event)
   {
      switch (event.operationType)
      {
         case "create_console_command":
            createConsoleCommandSynchronously(event.messageId, event.command, event.explanation, event.requestId);
            break;
         case "create_terminal_command":
            createTerminalCommandSynchronously(event.messageId, event.command, event.explanation, event.requestId);
            break;
         case "edit_file_command":  // Handle both formats from R
            createEditFileCommandSynchronously(event.messageId, event.filename, event.content, event.explanation, event.requestId, event.skipDiffHighlighting, event.diffData);
            break;
         case "create_user_message":
            createUserMessageSynchronously(event.messageId, event.content);
            break;
         case "create_assistant_message":
            createAssistantMessageSynchronously(event.messageId, event.content);
            break;
         case "clear_conversation":
            clearAllContent();
            // Reset expected sequence when conversation is cleared and rebuilt
            // Set to 0 so that after increment it becomes 1, matching start_background_recreation
            expectedSequence_ = 0;
            eventBuffer_.clear();
            // Update the conversation sequence tracking
            if (currentConversationId_ != -1) {
               conversationSequences_.put(currentConversationId_, 0);
            }
            break;
         case "revert_button":
            // Call the JavaScript function to create revert buttons
            callAiCreateUserRevertButton(event.messageId);
            break;
         case "hide_widget_buttons":
            // Hide buttons for widgets that were already clicked before page refresh
            hideWidgetButtonsSynchronously(event.messageId, event.content); // content contains widget_type
            break;
         case "create_function_call_message":
            // Create permanent function call message
            createFunctionCallMessageSynchronously(event.messageId, event.content);
            break;
         case "start_background_recreation":
            startBackgroundRecreation();
            break;
         case "finish_background_recreation":
            finishBackgroundRecreation();
            break;
         default:
            // Unknown operation type - skip
            break;
      }
   }
   
   /**
    * Process a stream event synchronously without markdown rendering delays
    */
   private void processStreamEventSynchronously(AiStreamDataEvent event)
   {
      String messageId = event.getMessageId();
      boolean isFunctionCall = event.isFunctionCall();
      
      // Handle function call completion events
      if (isFunctionCall && event.isComplete())
      {
         return;
      }
      
      // Determine what type of content this is
      if (event.isEditFile())
      {
         // Create edit file widget immediately if needed
         if (!editFileWidgets_.containsKey(messageId))
         {
            String filename = event.getFilename();
            if (filename == null || filename.isEmpty()) {
               throw new RuntimeException("Edit file event missing required filename for messageId: " + messageId);
            }
            String requestId = event.getRequestId();
            createEditFileCommandSynchronously(messageId, filename, "", "Edit file", requestId, false, (com.google.gwt.core.client.JavaScriptObject) null);
         }
         
         // Add content to widget (or replace if replaceContent flag is set)
         addContentToEditFileWidget(messageId, event.getDelta(), event.isComplete(), event.isCancelled(), event.getReplaceContent(), (com.google.gwt.core.client.JavaScriptObject) null);
      }
      else if (event.isConsoleCmd())
      {
         
         // Create console widget immediately if needed
         if (!consoleWidgets_.containsKey(messageId))
         {
            String requestId = event.getRequestId();
            createConsoleCommandSynchronously(messageId, "", "Console command", requestId);
         }
         
         // Add content to console widget
         addContentToConsoleWidget(messageId, event.getDelta(), event.isComplete(), event.isCancelled());
      }
      else if (event.isTerminalCmd())
      {
         
         // Create terminal widget immediately if needed
         if (!terminalWidgets_.containsKey(messageId))
         {
            String requestId = event.getRequestId();
            createTerminalCommandSynchronously(messageId, "", "Terminal command", requestId);
         }
         
         // Add content to terminal widget
         addContentToTerminalWidget(messageId, event.getDelta(), event.isComplete(), event.isCancelled());
      }
      else
      {
         // Check if this should be a console or terminal widget instead
         if (consoleWidgets_.containsKey(messageId) || terminalWidgets_.containsKey(messageId))
         {
            return;
         }
         
         // Skip creating assistant messages for conversation name generation (silent background operation)
         if (messageId != null && messageId.startsWith("conv_name_"))
         {
            return;
         }
         
         // Regular streaming text
         if (!streamingMessages_.containsKey(messageId))
         {
            // Initialize tracking FIRST to prevent race condition with first chunk
            streamingMessages_.put(messageId, "");
            createAssistantMessageContainerSynchronously(messageId);
         }
         
         // Update content synchronously (no async markdown rendering during streaming)
         updateAssistantMessageContentSynchronously(messageId, event.getDelta(), event.isComplete(), event.isCancelled(), (com.google.gwt.core.client.JavaScriptObject) null);
         
         // Mark text completion when complete
         if (event.isComplete() && !event.isCancelled())
         {
            Element messageElement = getElementById(messageId);
            if (messageElement != null)
            {
               messageElement.addClassName("stream-complete");
            }
         }
      }
   }
   
   /**
    * Create user message synchronously (public for historical message loading)
    */
   public void createUserMessageSynchronously(String messageId, String content)
   {
      // Reset conversation name generation flag for new user query
      conversationNameAttemptedForThisTurn_ = false;
      
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement == null)
      {
         return;
      }
      
      // Create user message container
      Element userContainer = Document.get().createDivElement();
      userContainer.setClassName("user-container");
      
      Element messageDiv = Document.get().createDivElement();
      messageDiv.setClassName("message user");
      messageDiv.setId(messageId);
      
      Element textDiv = Document.get().createDivElement();
      textDiv.setClassName("text");
      textDiv.setInnerText(content);
      
      messageDiv.appendChild(textDiv);
      userContainer.appendChild(messageDiv);
      
      // Insert in correct position
      insertElementInOrder(conversationElement, userContainer, messageId, currentProcessingSequence_);
      
      // For user messages, force scroll to show their new content - but not during background recreation
      if (!recreationMode_) {
         scrollManager_.forceScrollToBottom();
      }
   }
   
   /**
    * Create assistant message container synchronously
    */
   private void createAssistantMessageContainerSynchronously(String messageId)
   {
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement == null)
      {
         return;
      }
      
      // Check if element already exists
      Element existingElement = getElementById(messageId);
      if (existingElement != null)
      {
         return;
      }
      
      // Hide thinking message when first assistant response starts
      hideThinkingMessage();
      
      Element messageDiv = Document.get().createDivElement();
      messageDiv.setClassName("message assistant");
      messageDiv.setId(messageId);
      
      Element contentDiv = Document.get().createDivElement();
      contentDiv.setClassName("text");
      contentDiv.setId("content-" + messageId);
      
      messageDiv.appendChild(contentDiv);
      
      // Insert in correct position
      insertElementInOrder(conversationElement, messageDiv, messageId, currentProcessingSequence_);
      
      // Note: streamingMessages_ is now initialized before this method is called
      
      // Update scroll manager streaming status
      updateScrollManagerStreamingStatus();
   }
   
   /**
    * Create complete assistant message synchronously with markdown rendering
    */
   private void createAssistantMessageSynchronously(String messageId, String content)
   {
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement == null)
      {
         return;
      }
      
      Element messageDiv = Document.get().createDivElement();
      messageDiv.setClassName("message assistant");
      messageDiv.setId(messageId);
      
      Element contentDiv = Document.get().createDivElement();
      contentDiv.setClassName("text");
      contentDiv.setId("content-" + messageId);
      
      messageDiv.appendChild(contentDiv);
      
      // Insert in correct position
      insertElementInOrder(conversationElement, messageDiv, messageId, currentProcessingSequence_);
      
      // Render markdown for complete message
      renderMarkdownContent(content, new CommandWithArg<String>() {
         @Override
         public void execute(String renderedHtml)
         {
            contentDiv.setInnerHTML(renderedHtml);
         }
      });
   }
   
   /**
    * Create function call message synchronously with thinking message styling
    */
   private void createFunctionCallMessageSynchronously(String messageId, String functionContent)
   {
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement == null)
      {
         return;
      }
      
      // Check if element already exists (only in active container during background recreation)
      Element existingElement = null;
      if (recreationMode_ && backgroundContainer_ != null) {
         // During background recreation, only check within the background container
         existingElement = findElementInContainer(backgroundContainer_, messageId);
      } else {
         // Normal mode: check entire document
         existingElement = getElementById(messageId);
      }
      
      if (existingElement != null)
      {
         return;
      }
      
      // Hide thinking message when function call starts
      hideThinkingMessage();
      
      Element messageDiv = Document.get().createDivElement();
      messageDiv.setClassName("message assistant function-call-message");
      messageDiv.setId(messageId);
      
      Element contentDiv = Document.get().createDivElement();
      contentDiv.setClassName("text");
      contentDiv.setId("content-" + messageId);
      
      // Just display the function content directly, like thinking messages
      contentDiv.setInnerText(functionContent);
      
      messageDiv.appendChild(contentDiv);
      
      // Insert in correct position
      insertElementInOrder(conversationElement, messageDiv, messageId, currentProcessingSequence_);
      
      // Use smart scroll for function calls - but not during background recreation
      if (!recreationMode_) {
         scrollManager_.smartScrollToBottom();
      }
   }

   
   /**
    * Update assistant message content synchronously with real-time markdown rendering
    */
   private void updateAssistantMessageContentSynchronously(String messageId, String delta, boolean isComplete, boolean isCancelled, com.google.gwt.core.client.JavaScriptObject diffData)
   {
      String currentContent = streamingMessages_.get(messageId);
      if (currentContent == null)
      {
         currentContent = "";
      }
      
      String newContent = currentContent + delta;
      streamingMessages_.put(messageId, newContent);
      
      Element contentElement = getElementById("content-" + messageId);
      if (contentElement != null)
      {
         // Always render markdown in real-time, both during streaming and when complete
         renderMarkdownContent(newContent, new CommandWithArg<String>() {
            @Override
            public void execute(String renderedHtml)
            {
               contentElement.setInnerHTML(renderedHtml);
            }
         });
         
         if (isComplete)
         {
            // Keep tracking content for cancelled responses to preserve them
            if (!isCancelled) {
               // Only clean up tracking for normal completion, not cancellation
               streamingMessages_.remove(messageId);
            }
            
            // Update scroll manager streaming status
            updateScrollManagerStreamingStatus();
            
            // Hide cancel button when streaming completes
            AiPane aiPane = AiPane.getCurrentInstance();
            if (aiPane != null) {
               aiPane.hideCancelButton();
            }
            
            // Trigger conversation name generation only for non-cancelled responses
            // Only attempt once per user query turn
            if (!isCancelled && !conversationNameAttemptedForThisTurn_) {
               conversationNameAttemptedForThisTurn_ = true;
               triggerConversationNameCheck();
            }
         }
      }
   }
   
   /**
    * Create console command widget synchronously
    */
   private void createConsoleCommandSynchronously(String messageId, String command, String explanation, String requestId)
   {
      // Check if console widget already exists
      if (consoleWidgets_.containsKey(messageId))
      {
         return;
      }
      
      // Hide thinking message when AI response (function call) starts
      hideThinkingMessage();
      
      // Create console command handler using the correct interface
      AiConsoleWidget.ConsoleCommandHandler handler = new AiConsoleWidget.ConsoleCommandHandler() {
         @Override
         public void onRun(String msgId, String cmd) {
            handleAcceptConsoleCommand(msgId, cmd);
            onFunctionCallCompleted(msgId);
         }
         
         @Override
         public void onCancel(String msgId) {
            handleCancelConsoleCommand(msgId);
            onFunctionCallCompleted(msgId);
         }
      };
      
      // Create the console widget with correct constructor
      AiConsoleWidget consoleWidget = new AiConsoleWidget(messageId, command, explanation, requestId, true, handler);
      
      // Store widget in map BEFORE injecting into DOM
      consoleWidgets_.put(messageId, consoleWidget);
      
      createAndInjectWidgetSynchronously(messageId, consoleWidget, styles_.consoleCommand(), styles_.consoleWidgetContainer());
   }
   
   /**
    * Create terminal command widget synchronously
    */
   private void createTerminalCommandSynchronously(String messageId, String command, String explanation, String requestId)
   {
      // Hide thinking message when AI response (function call) starts
      hideThinkingMessage();
      
      // Create terminal command handler
      AiTerminalWidget.TerminalCommandHandler handler = new AiTerminalWidget.TerminalCommandHandler() {
         @Override
         public void onRunCommand(String msgId, String cmd) {
            handleAcceptTerminalCommand(msgId, cmd);
            onFunctionCallCompleted(msgId);
         }
         
         @Override
         public void onCancelCommand(String msgId) {
            handleCancelTerminalCommand(msgId);
            onFunctionCallCompleted(msgId);
         }
      };
      
      // Create the terminal widget
      AiTerminalWidget terminalWidget = new AiTerminalWidget(messageId, command, explanation, requestId, handler);
      terminalWidgets_.put(messageId, terminalWidget);
      
      createAndInjectWidgetSynchronously(messageId, terminalWidget, styles_.terminalCommand(), styles_.terminalWidgetContainer());
   }
   
   /**
    * Create edit file command widget synchronously
    */
   private void createEditFileCommandSynchronously(String messageId, String filename, String content, String explanation, String requestId, boolean skipDiffHighlighting, com.google.gwt.core.client.JavaScriptObject diffData)
   {
      // Hide thinking message when AI response (function call) starts
      hideThinkingMessage();
      
      // Check if this is a cancelled edit by looking for special prefix
      boolean isCancelled = false;
      String actualContent = content;
      if (content != null && content.startsWith("CANCELLED:")) {
         isCancelled = true;
         actualContent = content.substring("CANCELLED:".length()); // Remove the prefix
      }
      
      // Create edit file command handler
      org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget.EditFileCommandHandler handler = 
         new org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget.EditFileCommandHandler() {
            @Override
            public void onAccept(String msgId, String editedContent) {
               handleAcceptEditFileCommand(msgId, editedContent);
               onFunctionCallCompleted(msgId);
            }
            
            @Override
            public void onCancel(String msgId) {
               handleCancelEditFileCommand(msgId);
               onFunctionCallCompleted(msgId);
            }
         };
      
      // Create the edit file widget with appropriate cancellation flag and diff highlighting control
      // For cancelled edits: isEditable = false (no buttons), isCancelled = true
      org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget editFileWidget = 
         new org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget(messageId, filename, actualContent, explanation, requestId, !isCancelled, handler, isCancelled, skipDiffHighlighting, diffData);
      
      editFileWidgets_.put(messageId, editFileWidget);
      
      // For live streaming: hide buttons until diff is ready
      // For historical restoration: keep buttons visible since diff is already complete
      if ((!isCancelled && !recreationMode_) || (!isCancelled && skipDiffHighlighting)) {
         editFileWidget.hideButtons();
      }
      
      createAndInjectWidgetSynchronously(messageId, editFileWidget, styles_.editFileCommand(), styles_.editFileWidgetContainer());
   }
   
   /**
    * Create and inject widget synchronously (no scheduleDeferred)
    */
   private void createAndInjectWidgetSynchronously(String messageId, Widget widget, String commandStyle, String containerStyle)
   {
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement == null)
      {
         return;
      }
      
      // Create message container
      Element messageContainer = Document.get().createDivElement();
      messageContainer.setClassName("message assistant " + commandStyle);
      messageContainer.setId(messageId);
      
      // Create widget container
      Element widgetContainer = Document.get().createDivElement();
      widgetContainer.setClassName(containerStyle);
      
      // Attach widget to container synchronously
      widgetContainer.appendChild(widget.getElement());
      messageContainer.appendChild(widgetContainer);
      
      // Insert in correct position
      insertElementInOrder(conversationElement, messageContainer, messageId, currentProcessingSequence_);
   }
   
   /**
    * Insert element in correct order based on sequence number
    * Since we now have unified sequence numbers, use those for ordering instead of message IDs
    */
   private void insertElementInOrder(Element parent, Element newElement, String messageId, int sequence)
   {
      // Check if user was at bottom before insertion (only during non-recreation mode)
      boolean wasAtBottom = false;
      if (!recreationMode_) {
         wasAtBottom = scrollManager_.isUserAtBottom();
      }
      
      // Store the sequence number on the element for ordering
      newElement.setAttribute("data-sequence", String.valueOf(sequence));
      
      // Find correct insertion point based on sequence numbers
      com.google.gwt.dom.client.NodeList<com.google.gwt.dom.client.Element> children = parent.getChildNodes().cast();
      Element insertBeforeElement = null;
      
      for (int i = 0; i < children.getLength(); i++)
      {
         Element child = children.getItem(i);
         String childSequenceStr = child.getAttribute("data-sequence");
         
         if (childSequenceStr != null && !childSequenceStr.isEmpty())
         {
            try {
               int childSequence = Integer.parseInt(childSequenceStr);
               if (childSequence > sequence)
               {
                  insertBeforeElement = child;
                  break;
               }
            } catch (NumberFormatException ignored) {
               // Skip elements without valid sequence numbers
            }
         }
      }
      
      if (insertBeforeElement != null)
      {
         parent.insertBefore(newElement, insertBeforeElement);
      }
      else
      {
         parent.appendChild(newElement);
      }
      
      // If user was at bottom before injection, scroll to bottom after injection
      if (wasAtBottom && !recreationMode_) {
         scrollManager_.smartScrollToBottom();
      }
   }
   
   /**
    * Add content to edit file widget (backward compatibility)
    */
   private void addContentToEditFileWidget(String messageId, String delta, boolean isComplete, boolean isCancelled)
   {
      addContentToEditFileWidget(messageId, delta, isComplete, isCancelled, false, (com.google.gwt.core.client.JavaScriptObject) null);
   }

   /**
    * Add content to edit file widget with replaceContent option
    */
   private void addContentToEditFileWidget(String messageId, String delta, boolean isComplete, boolean isCancelled, boolean replaceContent, com.google.gwt.core.client.JavaScriptObject diffData)
   {
      org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget editFileWidget = editFileWidgets_.get(messageId);
      if (editFileWidget == null)
      {
         return;
      }
      
      // Handle content replacement vs appending
      String newEditContent;
      if (replaceContent) {
         newEditContent = delta;
         editFileStreamingContent_.put(messageId, newEditContent);
      } else {
         // Normal streaming: append to existing content
         String currentEditContent = editFileStreamingContent_.get(messageId);
         if (currentEditContent == null)
         {
            currentEditContent = "";
            // Update scroll manager streaming status when starting to stream edit file content
            updateScrollManagerStreamingStatus();
         }
      
         newEditContent = currentEditContent + delta;
         editFileStreamingContent_.put(messageId, newEditContent);
      }
      
      if (isComplete)
      {
         // Parse and clean content on completion
         String filename = editFileWidget.getFilename();
         String cleanedContent = parseCodeBlockContent(newEditContent, filename);
         
         editFileWidget.setContent(cleanedContent);
         
         // Keep tracking content for cancelled responses to preserve them
         if (!isCancelled) {
            // Only clean up tracking for normal completion, not cancellation
            editFileStreamingContent_.remove(messageId);
         }
         
         // Update scroll manager streaming status
         updateScrollManagerStreamingStatus();
         
         // Hide cancel button when edit_file streaming completes
         AiPane aiPane = AiPane.getCurrentInstance();
         if (aiPane != null) {
            aiPane.hideCancelButton();
         }
      }
      else
      {
         // Set raw content for streaming effect
         editFileWidget.setContent(newEditContent);
      }
   }
   
   /**
    * Add streaming content to console widget
    */
   private void addContentToConsoleWidget(String messageId, String delta, boolean isComplete, boolean isCancelled)
   {
      AiConsoleWidget consoleWidget = consoleWidgets_.get(messageId);
      if (consoleWidget == null)
      {
         return;
      }
      
      // Append delta to the current command
      String currentCommand = consoleWidget.getCommand();
      String newCommand = currentCommand + delta;
      consoleWidget.setCommand(newCommand);
      
      if (isComplete)
      {
         // Update scroll manager streaming status
         updateScrollManagerStreamingStatus();
         
         // Hide cancel button when console streaming completes
         AiPane aiPane = AiPane.getCurrentInstance();
         if (aiPane != null) {
            aiPane.hideCancelButton();
         }
      }
   }

   /**
    * Add streaming content to terminal widget
    */
   private void addContentToTerminalWidget(String messageId, String delta, boolean isComplete, boolean isCancelled)
   {
      AiTerminalWidget terminalWidget = terminalWidgets_.get(messageId);
      if (terminalWidget == null)
      {
         return;
      }
      
      // Append delta to the current command
      String currentCommand = terminalWidget.getCommand();
      String newCommand = currentCommand + delta;
      terminalWidget.setCommand(newCommand);
      
      if (isComplete)
      {
         // Update scroll manager streaming status
         updateScrollManagerStreamingStatus();
         
         // Hide cancel button when terminal streaming completes
         AiPane aiPane = AiPane.getCurrentInstance();
         if (aiPane != null) {
            aiPane.hideCancelButton();
         }
      }
   }

   // Handler methods for widget interactions
   private void handleAcceptConsoleCommand(String messageId, String command)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleAcceptConsoleCommand(messageId, command);
      }
   }
   
   private void handleCancelConsoleCommand(String messageId)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleCancelConsoleCommand(messageId);
      }
   }
   
   private void handleAcceptTerminalCommand(String messageId, String command)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleAcceptTerminalCommand(messageId, command);
      }
   }
   
   private void handleCancelTerminalCommand(String messageId)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleCancelTerminalCommand(messageId);
      }
   }
   
   private void handleAcceptEditFileCommand(String messageId, String content)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleAcceptEditFileCommand(messageId, content);
      }
   }
   
   /**
    * Handle cancel edit file command
    */
   private void handleCancelEditFileCommand(String messageId)
   {
      org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
         org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
      if (aiPane != null)
      {
         aiPane.handleCancelEditFileCommand(messageId);
      }
   }
   
   /**
    * Hide buttons for a specific widget when restoring from conversation history
    */
   private void hideWidgetButtonsSynchronously(String messageId, String widgetType)
   {
      if ("console".equals(widgetType))
      {
         AiConsoleWidget consoleWidget = consoleWidgets_.get(messageId);
         if (consoleWidget != null)
         {
            consoleWidget.hideButtons();
         }
      }
      else if ("terminal".equals(widgetType))
      {
         AiTerminalWidget terminalWidget = terminalWidgets_.get(messageId);
         if (terminalWidget != null)
         {
            terminalWidget.hideButtons();
         }
      }
      else if ("edit_file".equals(widgetType))
      {
         org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget editFileWidget = editFileWidgets_.get(messageId);
         if (editFileWidget != null)
         {
            editFileWidget.hideButtons();
         }
      }
   }
   
   /**
    * Get terminal widget by message ID
    */
   public AiTerminalWidget getTerminalWidget(String messageId)
   {
      return terminalWidgets_.get(messageId);
   }
   
   /**
    * Get console widget by message ID
    */
   public AiConsoleWidget getConsoleWidget(String messageId)
   {
      return consoleWidgets_.get(messageId);
    }
   
   /**
    * Get edit file widget by message ID
    */
   public org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget getEditFileWidget(String messageId)
   {
      return editFileWidgets_.get(messageId);
   }
   
   /**
    * Add a user message with just content (used by AiViewManager for historical messages)
    */
   public void addUserMessage(String content)
   {
      // Generate a simple messageId for historical messages
      String messageId = "user-" + System.currentTimeMillis();
      createUserMessageSynchronously(messageId, content);
   }
   
   /**
    * Common method for rendering markdown with consistent cleanup
    */
   private void renderMarkdownContent(String content, CommandWithArg<String> callback)
   {
      Markdown.markdownToHtml(content, new CommandWithArg<String>() {
         @Override
         public void execute(String renderedHtml)
         {
            // Clean up excessive whitespace from rendered HTML while preserving structure
            String cleanedHtml = renderedHtml
               .replaceAll("\\s{3,}", " ")      // Replace 3 or more spaces with single space (preserve intentional double spaces)
               .replaceAll(">\\s*\\n\\s*<", "><")  // Remove whitespace and newlines only between tags
               .trim();                        // Remove leading/trailing whitespace
            
            // Add wrapper div with proper spacing class for assistant messages
            cleanedHtml = "<div class='markdown-content'>" + cleanedHtml + "</div>";
            
            callback.execute(cleanedHtml);
         }
      });
   }
   
   /**
    * Get element by ID from the current HTML
    */
   private Element getElementById(String id)
   {
      Element element = getElement().getOwnerDocument().getElementById(id);
      return element;
   }
   
   /**
    * Find element by ID within a specific container (not entire document)
    */
   private Element findElementInContainer(Element container, String id)
   {
      if (container == null || id == null) {
         return null;
      }
      
      // Check if the container itself has the ID
      if (id.equals(container.getId())) {
         return container;
      }
      
      // Search children recursively
      com.google.gwt.dom.client.NodeList<com.google.gwt.dom.client.Element> children = container.getChildNodes().cast();
      for (int i = 0; i < children.getLength(); i++) {
         com.google.gwt.dom.client.Element child = children.getItem(i);
         if (child != null) {
            // Check if this child has the ID
            if (id.equals(child.getId())) {
               return child;
            }
            
            // Recursively search this child's children
            Element found = findElementInContainer(child, id);
            if (found != null) {
               return found;
            }
         }
      }
      
      return null;
   }
   
   /**
    * Extract numeric message ID from a string like "2" or "assistant-123" or "console-container-2"
    */
   private Integer extractMessageIdNumber(String messageId)
   {
      if (messageId == null || messageId.isEmpty()) {
         return null;
      }
      
      try {
         // Try parsing as direct number first
         return Integer.parseInt(messageId);
      } catch (NumberFormatException e) {
         // Try extracting number from patterns like "assistant-123" or "console-container-2"
         String[] parts = messageId.split("-");
         for (String part : parts) {
            try {
               return Integer.parseInt(part);
            } catch (NumberFormatException ignored) {
               // Continue to next part
            }
         }
         return null;
      }
   }
   
   /**
    * Parse code block content and remove markdown code block markers
    * Based on the logic from SessionAiSearch.R process_code_blocks function
    */
   private String parseCodeBlockContent(String content, String filename)
   {
      if (content == null || content.trim().isEmpty()) {
         return content;
      }
      
      // Check for different types of code blocks
      boolean hasRmdBlock = content.contains("````");
      boolean hasRegularCodeBlock = content.contains("```");
      
      String cleanedContent = content;
      
      try {
         if (hasRmdBlock) {
            // Handle RMD blocks with ````
            // Look for pattern: ````optional_language\n...content...````
            if (content.indexOf("````") != -1) {
               int startIndex = content.indexOf("````");
               int endIndex = content.lastIndexOf("````");
               
               if (startIndex != endIndex && endIndex > startIndex) {
                  // Find the end of the first line (after language specifier)
                  int firstLineEnd = content.indexOf('\n', startIndex);
                  if (firstLineEnd != -1 && firstLineEnd < endIndex) {
                     // Extract content between first newline and closing ````
                     String extracted = content.substring(firstLineEnd + 1, endIndex);
                     
                     // Remove YAML front matter if present
                     if (extracted.startsWith("---\n")) {
                        int yamlEnd = extracted.indexOf("\n---\n");
                        if (yamlEnd != -1) {
                           extracted = extracted.substring(yamlEnd + 5);
                        }
                     }
                     
                     cleanedContent = extracted;
                  }
               }
            }
         }
         else if (hasRegularCodeBlock) {
            // Handle regular code blocks with ```
            // Look for pattern: ```optional_language\n...content...```
            int startIndex = content.indexOf("```");
            // Find the next ``` after the first one (avoid matching the same block)
            int endIndex = content.indexOf("```", startIndex + 3);
            
            if (endIndex != -1 && endIndex > startIndex) {
               // Find the end of the first line (after language specifier)
               int firstLineEnd = content.indexOf('\n', startIndex);
               if (firstLineEnd != -1 && firstLineEnd < endIndex) {
                  // Extract content between first newline and closing ```
                  cleanedContent = content.substring(firstLineEnd + 1, endIndex);
               }
            }
         }
      } catch (Exception e) {
         Debug.log("EDIT_FILE_DEBUG: Error parsing code block content: " + e.getMessage());
         return content;
      }   
      // Return content without trimming to preserve empty lines
      return cleanedContent;   
   }
   
   /**
    * Get programming language from filename extension
    */
   private String getLanguageFromFilename(String filename)
   {
      if (filename == null) {
         return null;
      }
      
      String lowerFilename = filename.toLowerCase();
      if (lowerFilename.endsWith(".r")) {
         return "r";
      } else if (lowerFilename.endsWith(".py")) {
         return "python";
      } else if (lowerFilename.endsWith(".js")) {
         return "javascript";
      } else if (lowerFilename.endsWith(".java")) {
         return "java";
      } else if (lowerFilename.endsWith(".cpp") || lowerFilename.endsWith(".c")) {
         return "cpp";
      } else if (lowerFilename.endsWith(".sh") || lowerFilename.endsWith(".bash")) {
         return "bash";
      } else if (lowerFilename.endsWith(".sql")) {
         return "sql";
      } else if (lowerFilename.endsWith(".html")) {
         return "html";
      } else if (lowerFilename.endsWith(".css")) {
         return "css";
      } else if (lowerFilename.endsWith(".json")) {
         return "json";
      } else if (lowerFilename.endsWith(".rmd")) {
         return "rmd";
      }
      
      return null;
   }
   
   // SCROLLING METHODS MOVED TO AiScrollManager
   
   /**
    * Update the scroll manager with current streaming status
    */
   private void updateScrollManagerStreamingStatus()
   {
      boolean isStreaming = !streamingMessages_.isEmpty() || !editFileStreamingContent_.isEmpty();
      scrollManager_.setActivelyStreaming(isStreaming);
   }
   
   /**
    * Clear all conversation content and tracking maps
    */
   private void clearTrackingMaps()
   {
      streamingMessages_.clear();
      consoleWidgets_.clear();
      terminalWidgets_.clear();
      editFileWidgets_.clear();
      editFileStreamingContent_.clear();
      
      // Reset function call processing state
      functionCallBuffer_.clear();
      processingFunctionCall_ = false;
      currentFunctionCallMessageId_ = null;
   }
   
   /**
    * Clear all messages and reinitialize display for current conversation
    * CRITICAL: This clears UI but maintains per-conversation sequence tracking
    */
   public void clearMessages()
   {
      clearTrackingMaps();
      // Clear buffer but keep conversation sequence state
      eventBuffer_.clear();
      initializeConversationDisplay();
      
      // No automatic scrolling on clear - let switchToConversation() handle navigation scrolling
   }
   
   /**
    * Clear all messages without restoring scroll position
    * Used during conversation reconstruction/refresh where we don't want to interfere with scroll
    */
   public void clearMessagesNoRestore()
   {
      clearTrackingMaps();
      // Clear buffer but keep conversation sequence state
      eventBuffer_.clear();
      initializeConversationDisplay();
   }
   
   /**
    * Clear all conversation content without reinitializing display
    */
   public void clearAllContent()
   {
      // Clear existing content
      Element conversationElement = getActiveConversationContainer();
      if (conversationElement != null) {
         conversationElement.setInnerHTML("");
      }
      
      clearTrackingMaps();
   }
   
   /**
    * Start background recreation mode
    */
   private void startBackgroundRecreation()
   {
      recreationMode_ = true;
      
      // CRITICAL: Clear widget maps to prevent widget creation functions from returning early
      // This ensures widgets are recreated from scratch on subsequent visits
      clearTrackingMaps();
      
      // Remember current scroll position
      int currentScrollTop = scrollManager_.getScrollTop();
      
      // Create hidden background container
      backgroundContainer_ = Document.get().createDivElement();
      backgroundContainer_.setId("background-conversation");
      backgroundContainer_.setClassName("ai-streaming-panel");
      backgroundContainer_.getStyle().setVisibility(com.google.gwt.dom.client.Style.Visibility.HIDDEN);
      backgroundContainer_.getStyle().setPosition(com.google.gwt.dom.client.Style.Position.ABSOLUTE);
      backgroundContainer_.getStyle().setTop(-10000, com.google.gwt.dom.client.Style.Unit.PX);
      
      // Add to document body (hidden)
      Document.get().getBody().appendChild(backgroundContainer_);
   }
   
   /**
    * Finish background recreation and swap to foreground
    */
   private void finishBackgroundRecreation()
   {
      if (!recreationMode_ || backgroundContainer_ == null) {
         return;
      }
            
      // Get foreground container
      Element foregroundContainer = getElementById("streaming-conversation");
      if (foregroundContainer == null) {
         return;
      }
      
      // Atomic swap: move actual DOM nodes (preserves widget connections)
      foregroundContainer.removeAllChildren();
      while (backgroundContainer_.getChildCount() > 0) {
         com.google.gwt.dom.client.Node child = backgroundContainer_.getFirstChild();
         backgroundContainer_.removeChild(child);
         foregroundContainer.appendChild(child);
      }
      
      // Use native method to find and scroll the actual scrollable parent to bottom
      // Use requestAnimationFrame to ensure DOM is fully updated before scrolling
      requestAnimationFrameScroll();
      
      // Cleanup
      backgroundContainer_.removeFromParent();
      backgroundContainer_ = null;
      recreationMode_ = false;
   }
   
   /**
    * Use requestAnimationFrame to ensure DOM is updated before scrolling
    */
   private native void requestAnimationFrameScroll() /*-{
      var self = this;
      $wnd.requestAnimationFrame(function() {
         self.@org.rstudio.studio.client.workbench.views.ai.widgets.AiStreamingPanel::scrollToBottomNative()();
      });
   }-*/;
   
   /**
    * Native method to find the actual scrollable parent and scroll to bottom instantly
    */
   private native void scrollToBottomNative() /*-{
      var element = this.@com.google.gwt.user.client.ui.UIObject::getElement()();
      
      // Find the actual scrollable parent by walking up the DOM tree
      var scrollableParent = element;
      while (scrollableParent) {
         var computedStyle = $wnd.getComputedStyle(scrollableParent);
         var overflowY = computedStyle.overflowY;
         
         // Check if this element is scrollable
         if ((overflowY === 'auto' || overflowY === 'scroll') && 
             scrollableParent.scrollHeight > scrollableParent.clientHeight) {
            // Found the scrollable parent - scroll to bottom instantly
            scrollableParent.scrollTop = scrollableParent.scrollHeight;
            return;
         }
         
         scrollableParent = scrollableParent.parentElement;
      }
      
      // Fallback: try window scroll
      $wnd.scrollTo(0, $doc.body.scrollHeight);
   }-*/;
   
   /**
    * Get the active conversation container (background during recreation, foreground otherwise)
    */
   private Element getActiveConversationContainer()
   {
      if (recreationMode_ && backgroundContainer_ != null) {
         return backgroundContainer_;
      }
      Element foreground = getElementById("streaming-conversation");
      return foreground;
   }
   
   /**
    * Add a complete assistant message without streaming (for historical messages)
    */
   public void addCompleteAssistantMessage(String messageId, String content)
   {
      // Create a unique assistant message ID for historical loading
      createAssistantMessageSynchronously(messageId, content);
   }
   
   /**
    * Preserve partial content from streaming when cancelled.
    * This method keeps accumulated content visible in the UI and ensures it gets saved to conversation log.
    * @param messageId The message ID of the streaming content
    * @return The accumulated content that was preserved, or null if none
    */
   public String preservePartialContentOnCancel(String messageId)
   {
      String preservedContent = null;
      
      // Preserve regular streaming content
      if (streamingMessages_.containsKey(messageId)) {
         preservedContent = streamingMessages_.get(messageId);
         // Force completion but mark as cancelled to preserve content in display
         if (preservedContent != null && !preservedContent.isEmpty()) {
            updateAssistantMessageContentSynchronously(messageId, "", true, true, (com.google.gwt.core.client.JavaScriptObject) null);
         }
      }
      
      // Preserve edit file content
      if (editFileStreamingContent_.containsKey(messageId)) {
         String editFileContent = editFileStreamingContent_.get(messageId);
         if (editFileContent != null && !editFileContent.isEmpty()) {
            // Keep the content in the edit file widget but mark as cancelled
            addContentToEditFileWidget(messageId, "", true, true, false, (com.google.gwt.core.client.JavaScriptObject) null);
            if (preservedContent == null) {
               preservedContent = editFileContent;
            }
         }
      }
      
      return preservedContent;
   }
   
   /**
    * Handle start conversation events
    */
   @Override
   public void onAiStartConversation(AiStartConversationEvent event)
   {
      // Clear any existing conversation and reset sequence tracking
      // Use clearMessagesNoRestore since this is usually called during conversation reconstruction
      clearMessagesNoRestore();
      
      // For new conversations, the user message and assistant response will come via operation events
      // with proper sequence numbers, so we don't need to create them here
   }

   /**
    * Triggers conversation name generation after streaming completes.
    * This connects streaming completion back to the established post-response workflow.
    */
   private void triggerConversationNameCheck() {
      // Use the exact same pattern as AiPaneResponses - delay conversation name check to avoid iframe conflicts
      com.google.gwt.user.client.Timer nameCheckTimer = new com.google.gwt.user.client.Timer() {
         @Override
         public void run() {
            try {
               // Get AiPane instance
               org.rstudio.studio.client.workbench.views.ai.AiPane aiPane = 
                  org.rstudio.studio.client.workbench.views.ai.AiPane.getCurrentInstance();
                  // Get conversations manager and call checkShouldPromptForName exactly like AiPaneResponses does
                  org.rstudio.studio.client.workbench.views.ai.AiPaneConversations conversationsManager = 
                     aiPane.getConversationsManager();
                     conversationsManager.checkShouldPromptForName(new org.rstudio.studio.client.server.ServerRequestCallback<Boolean>() {
                        @Override
                        public void onResponseReceived(Boolean shouldPrompt) {
                           if (shouldPrompt != null && shouldPrompt) {
                              // Get current conversation index (async call)
                              conversationsManager.getCurrentConversationIndex(new org.rstudio.studio.client.server.ServerRequestCallback<Double>() {
                                 @Override
                                 public void onResponseReceived(Double conversationIndex) {
                                    if (conversationIndex != null && conversationIndex.intValue() > 0) {
                                       // Get server operations through the AiPane instance
                                       org.rstudio.studio.client.workbench.views.ai.model.AiServerOperations server = 
                                          aiPane.getAiServerOperations();
                                       
                                       // Generate conversation name with the conversation ID
                                       server.generateConversationName(conversationIndex.intValue(), new org.rstudio.studio.client.server.ServerRequestCallback<String>() {
                                          @Override
                                          public void onResponseReceived(String generatedName) {
                                             if (generatedName != null && !generatedName.trim().isEmpty()) {
                                                // Update the conversations manager cache directly - no need to call setConversationName
                                                // since the R function now automatically saves the generated name
                                                conversationsManager.setConversationName(conversationIndex.intValue(), generatedName);
                                             }
                                          }
                                          
                                          @Override
                                          public void onError(org.rstudio.studio.client.server.ServerError error) {
                                             // Handle error silently
                                          }
                                       });
                                    }
                                 }
                                 
                                 @Override
                                 public void onError(org.rstudio.studio.client.server.ServerError error) {
                                    // Handle error silently
                                 }
                              });
                           }
                        }
                        
                        @Override
                        public void onError(org.rstudio.studio.client.server.ServerError error) {
                           // Handle error silently
                        }
                     });
            } catch (Exception e) {
               // Handle any errors silently
            }
         }
      };
      
      // Schedule the timer for 1000ms delay like AiPaneResponses does
      nameCheckTimer.schedule(1000);
   }
   
   /**
    * Handle streaming data events with per-message sequence buffering
    */
   @Override
   public void onAiStreamData(AiStreamDataEvent event)
   {
      String messageId = event.getMessageId();
      int sequence = event.getSequence();
      
      // Convert streaming events to queued events and use the main sequence system
      QueuedEvent queuedEvent = new QueuedEvent(event);
      
      if (sequence == expectedSequence_)
      {
         // Process immediately - this is the next expected event
         processQueuedEvent(queuedEvent, sequence);
         expectedSequence_++;
         
         // Process any buffered events that are now ready
         processBufferedEvents();
      }
      else if (sequence > expectedSequence_)
      {
         // Buffer for later - this event arrived early
         eventBuffer_.put(sequence, queuedEvent);
      }
      else
      {
         // This is a late/duplicate event - ignore it
      }
      
      // Use smart scroll during streaming - only scroll if user is near bottom
      scrollManager_.smartScrollToBottom();
   }
   
   /**
    * Show a thinking message in the streaming panel
    */
   public void showThinkingMessage()
   {
      showThinkingMessage("Thinking...");
   }
   
   /**
    * Show a thinking message with custom text in the streaming panel
    */
   public void showThinkingMessage(String messageText)
   {
      // Create thinking message synchronously
      Element conversationElement = getElementById("streaming-conversation");
      if (conversationElement == null)
      {
         Debug.log("DEBUG: conversationElement is null - cannot show thinking message");
         return;
      }
      
      // Remove any existing thinking message first
      hideThinkingMessage();
      
      // Create thinking message container
      Element thinkingContainer = Document.get().createDivElement();
      thinkingContainer.setClassName("assistant-container thinking-message-container");
      thinkingContainer.setAttribute("data-thinking", "true");
      thinkingContainer.setId("ai-thinking-message");
      
      Element messageDiv = Document.get().createDivElement();
      messageDiv.setClassName("message assistant thinking-message");
      
      Element textDiv = Document.get().createDivElement();
      textDiv.setClassName("text");
      
      // Create thinking content with animation
      Element thinkingContent = Document.get().createDivElement();
      thinkingContent.setClassName("thinking-content");
      thinkingContent.getStyle().setProperty("display", "flex");
      thinkingContent.getStyle().setProperty("alignItems", "center");
      
      Element thinkingText = Document.get().createSpanElement();
      thinkingText.setInnerText(messageText);
      thinkingText.setClassName("thinking-text");
      
      // Add CSS animation
      addThinkingMessageStyles();
      
      thinkingContent.appendChild(thinkingText);
      textDiv.appendChild(thinkingContent);
      messageDiv.appendChild(textDiv);
      thinkingContainer.appendChild(messageDiv);
      
      // Add to conversation (append at end)
      conversationElement.appendChild(thinkingContainer);
      
      // Scroll to bottom to show the thinking message (use smart scroll)
      scrollManager_.smartScrollToBottom();
   }
   
   /**
    * Update the thinking message text if one exists
    */
   public void updateThinkingMessage(String messageText)
   {
      Element thinkingMessage = getElementById("ai-thinking-message");
      if (thinkingMessage != null)
      {
         // Find the .thinking-text element within the thinking message using native JS
         Element textElement = findThinkingTextElement(thinkingMessage);
         if (textElement != null)
         {
            textElement.setInnerText(messageText);
         }
         else
         {
            // If no existing thinking message found, create one with the new text
            showThinkingMessage(messageText);
         }
      }
      else
      {
         // If no existing thinking message found, create one with the new text
         showThinkingMessage(messageText);
      }
   }
   
   /**
    * Find the thinking text element within a thinking message container
    */
   private native Element findThinkingTextElement(Element container) /*-{
      return container.querySelector('.thinking-text');
   }-*/;
   
   /**
    * Hide the thinking message in the streaming panel
    */
   public void hideThinkingMessage()
   {
      Element thinkingMessage = getElementById("ai-thinking-message");
      if (thinkingMessage != null && thinkingMessage.getParentElement() != null)
      {
         thinkingMessage.getParentElement().removeChild(thinkingMessage);
      }
      
      // Also remove any elements with thinking attribute
      Element conversationElement = getElementById("streaming-conversation");
      if (conversationElement != null)
      {
         removeElementsByAttribute(conversationElement, "data-thinking", "true");
      }
      
      // Remove thinking message styles
      removeThinkingMessageStyles();
   }
   
   /**
    * Add CSS styles for thinking message animation
    */
   private void addThinkingMessageStyles()
   {
      Element existingStyle = getElementById("thinking-message-style");
      if (existingStyle == null)
      {
         Element style = Document.get().createElement("style");
         style.setId("thinking-message-style");
         style.setInnerText(
            "@keyframes thinking-pulse { " +
            "  0%, 100% { opacity: 0.7; transform: scale(0.98); } " +
            "  50% { opacity: 1; transform: scale(1.02); } " +
            "}" +
            ".thinking-message { margin-left: 15px; opacity: 0.8; font-style: italic; }" +
            ".thinking-text { animation: thinking-pulse 1.5s infinite ease-in-out; }"
         );
         Document.get().getDocumentElement().appendChild(style);
      }
   }
   
   /**
    * Remove thinking message styles
    */
   private void removeThinkingMessageStyles()
   {
      Element style = getElementById("thinking-message-style");
      if (style != null && style.getParentElement() != null)
      {
         style.getParentElement().removeChild(style);
      }
   }
   
   /**
    * Remove elements by attribute
    */
   private native void removeElementsByAttribute(Element parent, String attribute, String value) /*-{
      var elements = parent.querySelectorAll('[' + attribute + '="' + value + '"]');
      for (var i = 0; i < elements.length; i++) {
         var element = elements[i];
         if (element && element.parentNode) {
            element.parentNode.removeChild(element);
         }
      }
   }-*/;
   
   private final EventBus eventBus_;
   private final Map<String, String> streamingMessages_;
   private final Map<String, AiConsoleWidget> consoleWidgets_;
   private final Map<String, AiTerminalWidget> terminalWidgets_;
   private final Map<String, org.rstudio.studio.client.workbench.views.ai.widgets.AiEditFileWidget> editFileWidgets_;
   private final Map<String, String> editFileStreamingContent_;

   // Per-conversation sequence tracking
   private final Map<Integer, Integer> conversationSequences_;
   private int currentConversationId_;
   private int expectedSequence_;
   private TreeMap<Integer, QueuedEvent> eventBuffer_;
   
   // Track the sequence number currently being processed for DOM ordering
   private int currentProcessingSequence_;
   
   // Simple background recreation system
   private boolean recreationMode_;
   private Element backgroundContainer_;
   
   // Function call buffering for parallel function calls (rao 0.2.3+)
   private List<QueuedEvent> functionCallBuffer_;
   private boolean processingFunctionCall_;
   private String currentFunctionCallMessageId_;
   
   // Streaming events now use the main sequence system
   
   // Scroll management
   private AiScrollManager scrollManager_;
   
   // Track whether we've already attempted conversation name generation for the current user query
   private boolean conversationNameAttemptedForThisTurn_ = false;


   
   /**
    * Add a function call operation to the buffer for sequential processing
    */
   private void addToFunctionCallBuffer(QueuedEvent functionCallEvent)
   {
      functionCallBuffer_.add(functionCallEvent);
   }
   
   /**
    * Check if there are buffered function calls waiting to be processed
    */
   private boolean hasPendingFunctionCalls()
   {
      return !functionCallBuffer_.isEmpty();
   }
   
   /**
    * Process the next function call from the buffer
    */
   private void processNextFunctionCall()
   {
      if (functionCallBuffer_.isEmpty() || processingFunctionCall_)
      {
         return;
      }
      
      QueuedEvent nextFunctionCall = functionCallBuffer_.remove(0);
      processingFunctionCall_ = true;
      currentFunctionCallMessageId_ = nextFunctionCall.messageId;
      
      // Process the function call widget
      processOperationEventSynchronously(nextFunctionCall);
   }
   
   /**
    * Called when a function call widget is completed (accepted/cancelled)
    */
   private void onFunctionCallCompleted(String messageId)
   {
      if (messageId.equals(currentFunctionCallMessageId_))
      {
         processingFunctionCall_ = false;
         currentFunctionCallMessageId_ = null;
         
         // Process the next function call if any
         if (hasPendingFunctionCalls())
         {
            processNextFunctionCall();
         }
      }
   }

   /**
    * Call the global JavaScript function to create revert buttons
    */
   private native void callAiCreateUserRevertButton(String messageId) /*-{
      if ($wnd.aiCreateUserRevertButton) {
         $wnd.aiCreateUserRevertButton(messageId);
      }
   }-*/;

   public String getConsoleContent()
   {
      try
      {
         // Access the console through RStudio's workbench
         // Try to get the console widget through the global workbench instance
         return getConsoleContentFromWorkbench();
      }
      catch (Exception e)
      {
         Debug.log("Error getting console content: " + e.getMessage());
         return "";
      }
   }

   private native String getConsoleContentFromWorkbench() /*-{
      try {
         // Access the console through the global workbench
         var workbench = $wnd.RStudio && $wnd.RStudio.workbench;
         if (workbench && workbench.console) {
            // Try to access the console widget's shell display
            var console = workbench.console;
            if (console.getShellWidget && console.getShellWidget()) {
               var shellWidget = console.getShellWidget();
               if (shellWidget.getConsoleOutputContent) {
                  return shellWidget.getConsoleOutputContent();
               }
            }
         }
         
         // Fallback: try to access through DOM
         var consoleOutput = $doc.getElementById('rstudio_console_output');
         if (consoleOutput) {
            return consoleOutput.innerText || consoleOutput.textContent || '';
         }
         
         return '';
      } catch(e) {
         return 'Error accessing console: ' + e.message;
      }
   }-*/;

   /**
    * Check if the console is currently busy (running code)
    * Based on ShellWidget.setBusy() which adds/removes "rstudio-console-busy" class
    * @return true if console is busy, false if ready for input
    */
   public boolean isConsoleBusy()
   {
      return isConsoleBusyNative();
   }

   private native boolean isConsoleBusyNative() /*-{
      try {
         // ShellWidget.setBusy() adds "rstudio-console-busy" class to the console input element
         var consoleInput = $doc.getElementById('rstudio_console_input');
         if (consoleInput) {
            return consoleInput.className.indexOf('rstudio-console-busy') !== -1;
         }
         return false;
      } catch(e) {
         return false;
      }
   }-*/;
   
   /**
    * Clear persistent diff indicators from all open editors when switching conversations
    */
   private void clearPersistentDiffIndicators()
   {
      clearAllPersistentDiffIndicatorsNative();
   }
   
   /**
    * Re-initialize persistent diff indicators for all open editors
    * This loads the diff indicators for the current conversation
    */
   private void reinitializePersistentDiffIndicators()
   {
      try {
         // Access the SourceColumnManager directly from RStudioGinjector
         org.rstudio.studio.client.workbench.views.source.SourceColumnManager columnManager = 
            org.rstudio.studio.client.RStudioGinjector.INSTANCE.getSourceColumnManager();
         
         if (columnManager != null) {
            // Get all columns and iterate through their editors
            java.util.ArrayList<org.rstudio.studio.client.workbench.views.source.SourceColumn> columns = 
               columnManager.getColumnList();
            
            int reinitializedCount = 0;
            for (org.rstudio.studio.client.workbench.views.source.SourceColumn column : columns) {
               // Get all editors in this column
               java.util.ArrayList<org.rstudio.studio.client.workbench.views.source.editors.EditingTarget> editors = 
                  column.getEditors();
               
               for (org.rstudio.studio.client.workbench.views.source.editors.EditingTarget editor : editors) {
                  // Check if this is a TextEditingTarget with an AceEditor
                  if (editor instanceof org.rstudio.studio.client.workbench.views.source.editors.text.TextEditingTarget) {
                     org.rstudio.studio.client.workbench.views.source.editors.text.TextEditingTarget textEditor = 
                        (org.rstudio.studio.client.workbench.views.source.editors.text.TextEditingTarget) editor;
                     
                     // Get the document path
                     String filePath = textEditor.getPath();
                     
                     if (filePath != null && !filePath.isEmpty()) {
                        // Get the AceEditor from the TextEditingTarget
                        org.rstudio.studio.client.workbench.views.source.editors.text.DocDisplay docDisplay = 
                           textEditor.getDocDisplay();
                        
                        if (docDisplay instanceof org.rstudio.studio.client.workbench.views.source.editors.text.AceEditor) {
                           org.rstudio.studio.client.workbench.views.source.editors.text.AceEditor aceEditor = 
                              (org.rstudio.studio.client.workbench.views.source.editors.text.AceEditor) docDisplay;
                           
                           // Re-initialize the persistent diff indicators for this editor
                           // This will clear existing state and load new diff data for the current conversation
                           aceEditor.initializePersistentDiffIndicators(filePath);
                           reinitializedCount++;
                        }
                     }
                  }
               }
            }  
         }
      } catch (Exception e) {
         Debug.log("DEBUG: Error re-initializing persistent diff indicators: " + e.getMessage());
      }
   }
   
   /**
    * Native method to clear all persistent diff indicators from all open text editors
    */
   private native void clearAllPersistentDiffIndicatorsNative() /*-{
      try {         
         var clearedCount = 0;
         
         // Access ACE editors directly by querying the DOM
         var aceEditors = $doc.querySelectorAll('.ace_editor');
         
         for (var i = 0; i < aceEditors.length; i++) {
            var aceElement = aceEditors[i];
            
            if (aceElement && aceElement.env && aceElement.env.editor) {
               var aceEditor = aceElement.env.editor;
               
               if (aceEditor.persistentDiffManager) {
                  aceEditor.persistentDiffManager.clearAll();
                  clearedCount++;
               }
            }
         }
         
      } catch (e) {
         $wnd.console.log("DEBUG: Error clearing persistent diff indicators: " + e.message);
      }
   }-*/;

} 