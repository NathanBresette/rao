/*
 * token_iterator.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// Mixins for the Ace TokenIterator 'class'.
define("mixins/token_iterator", ["require", "exports", "module"], function(require, exports, module) {

var TokenIterator = require("ace/token_iterator").TokenIterator;
var Range = require("ace/range").Range;

(function() {

   function isOpeningBracket(string, allowArrows)
   {
      return string.length === 1 && (
         string === "{" ||
         string === "(" ||
         string === "[" ||
         (!!allowArrows && string === "<"));
   }

   function isClosingBracket(string, allowArrows)
   {
      return string.length === 1 && (
         string === "}" ||
         string === ")" ||
         string === "]" ||
         (!!allowArrows && string === ">"));
   }

   var $complements = {

      "(" : ")",
      "{" : "}",
      "[" : "]",
      "<" : ">",

      ")" : "(",
      "}" : "{",
      "]" : "[",
      ">" : "<"
   };

   function getComplement(string)
   {
      return $complements[string];
   }

   this.moveToPreviousToken = function()
   {
      // First, check to see if we can use a token on the same row.
      var rowTokens = this.$rowTokens;
      var newIdx = this.$tokenIndex - 1;
      if (newIdx >= 0)
      {
         this.$tokenIndex--;
         return rowTokens[newIdx];
      }

      // Otherwise, walk back rows until we find a row
      // with tokens. Once we find one, put the iterator
      // at the last token on the row and return that token.
      var session = this.$session;
      var row = this.$row;
      
      if (row < 0)
         return null;

      while (true)
      {
         row--;
         if (row < 0)
            return null;
         
         rowTokens = session.getTokens(row);
         if (rowTokens && rowTokens.length)
         {
            this.$row = row;
            this.$tokenIndex = rowTokens.length - 1;
            this.$rowTokens = rowTokens;
            return rowTokens[rowTokens.length - 1];
         }
      }

      // cannot be reached
      
   };

   this.moveToNextToken = function()
   {
      // Check to see if we can use a token on the same row.
      var rowTokens = this.$rowTokens;
      var newIdx = this.$tokenIndex + 1;
      if (newIdx < rowTokens.length)
      {
         this.$tokenIndex++;
         return rowTokens[newIdx];
      };

      // Otherwise, walk up rows until we find a row with tokens.
      // Once found, set the token iterator to the first token on
      // that line, and return that token.
      var session = this.$session;
      var max = session.getLength();
      var row = this.$row;
      if (row >= max)
         return null;

      while (true)
      {
         row++;
         if (row >= max)
            return null;

         rowTokens = session.getTokens(row);
         if (rowTokens && rowTokens.length)
         {
            this.$row = row;
            this.$tokenIndex = 0;
            this.$rowTokens = rowTokens;
            return rowTokens[0];
         }
      }

      // cannot be reached
      
   };

   this.moveToNextSignificantToken = function()
   {
      if (!this.moveToNextToken())
         return false;

      var token = this.getCurrentToken();
      while (/^\s+$/.test(token.value) || /\bcomment\b/.test(token.type))
      {
         if (!this.moveToNextToken())
            return false;
         token = this.getCurrentToken();
      }

      return true;
   };

   this.moveToPreviousSignificantToken = function()
   {
      if (!this.moveToPreviousToken())
         return false;

      var token = this.getCurrentToken();
      while (/^\s+$/.test(token.value) || /\bcomment\b/.test(token.type))
      {
         if (!this.moveToPreviousToken())
            return false;
         token = this.getCurrentToken();
      }

      return true;
   };

   this.moveToStartOfRow = function()
   {
      this.$tokenIndex = 0;
      return this.getCurrentToken();
   };

   this.moveToEndOfRow = function()
   {
      this.$tokenIndex = this.$rowTokens.length - 1;
      return this.getCurrentToken();
   };

   this.moveToStartOfNextRowWithTokens = function()
   {
      var row = this.$row;
      var session = this.$session;
      var max = session.getLength();
      while (true)
      {
         row++;
         if (row >= max)
            return null;
         
         var tokens = session.getTokens(row);
         if (tokens && tokens.length)
         {
            this.$row = row;
            this.$tokenIndex = 0;
            this.$rowTokens = tokens;
            return this.getCurrentToken();
         }
      }
   };

   var updateTimerId;
   var renderStart = 0;
   var renderEnd   = 0;

   /**
    * Eagerly tokenize up to the specified row, using the tokenizer
    * attached to the associated session, but defer rendering the
    * associated tokens.
    */
   this.tokenizeUpToRow = function(maxRow)
   {
      var tokenizer = this.$session.bgTokenizer;

      renderStart = Math.min(renderStart, tokenizer.currentLine);
      renderEnd   = Math.max(renderEnd, maxRow);

      for (var i = tokenizer.currentLine; i <= maxRow; i++)
         tokenizer.$tokenizeRow(i);

      clearTimeout(updateTimerId);
      updateTimerId = setTimeout(function() {
         tokenizer.fireUpdateEvent(renderStart, renderEnd);
         renderStart = renderEnd;
         renderEnd = 0;
      }, 700);
   };

   /**
    * Move a TokenCursor to the token lying at position.
    * If no such token exists at that position, then we instead
    * move to the first token lying previous to that token.
    */
   this.moveToPosition = function(position, seekForward)
   {
      this.tokenizeUpToRow(position.row);

      // Try to get a token at the position supplied. Note that the
      // default behaviour of 'session.getTokenAt' is to return the first
      // token prior to the position supplied; for 'seekForward' behaviour
      // this is undesired.
      var token = this.$session.getTokenAt(position.row, position.column);
      if (token && seekForward && token.column < position.column)
         token = this.$session.getTokenAt(position.row, position.column + 1);

      // If no token was returned, place a token cursor at the first
      // cursor previous to that token.
      //
      // Based on some simple testing, we can see that:
      //
      //    session.getToken(0, -100) returns the first token,
      //    session.getToken(0, 1000) returns null
      //
      // And so a 'null' result implies that we specified a column that was
      // too large.
      if (token == null) {

         if (seekForward)
         {
            // Place the token cursor at the last token on the row
            // desired, and then move forward.
            this.$row = position.row;
            this.$rowTokens = this.$session.getTokens(this.$row);
            this.$tokenIndex = this.$rowTokens.length - 1;
            return this.moveToNextToken();
         }
         else
         {
            // Temporarily move to the first token on the next row.
            // It's okay if this doesn't actually exist.
            this.$row = position.row + 1;
            this.$tokenIndex = 0;
            this.$rowTokens = this.$session.getTokens(this.$row);
            return this.moveToPreviousToken();
         }
      }

      // Otherwise, just set the indices to match that token.
      this.$row = position.row,
      this.$rowTokens = this.$session.getTokens(this.$row);
      this.$tokenIndex = token.index;
      return this.getCurrentToken();
   };

   /**
    * Clones the current token iterator. The clone
    * keeps a reference to the same underlying session.
    */
   this.clone = function()
   {
      var clone = new TokenIterator(this.$session, 0, 0);
      clone.moveToTokenIterator(this);
      return clone;
   };

   /**
    * Move a token iterator to the same position as a
    * separate token iterator.
    */
   this.moveToTokenIterator = function(tokenIterator)
   {
      for (var key in tokenIterator)
         if (tokenIterator.hasOwnProperty(key))
            this[key] = tokenIterator[key];
   };

   /**
    * Get the token lying `offset` tokens ahead of
    * the token iterator. Returns `null` if no such
    * token exists.
    */
   this.peekFwd = function(offset)
   {
      var clone = this.clone();
      var token = null;
      for (var i = 0; i < offset; i++)
         token = clone.moveToNextToken();
      return token;
   };

   /**
    * Get the token lying `offset` tokens behind
    * the token iterator. Returns `null` if no such
    * token exists.
    */
   this.peekBwd = function(offset)
   {
      var clone = this.clone();
      var token = null;
      for (var i = 0; i < offset; i++)
         token = clone.moveToPreviousToken();
      return token;
   };

   this.getCurrentToken = function()
   {
      var token = this.$rowTokens[this.$tokenIndex];
      if (token)
         token.row = this.$row;
      return token;
   };

   /**
    * Get the value of the token at the TokenIterator's
    * current position.
    */
   this.getCurrentTokenValue = function()
   {
      return this.getCurrentToken().value;
   };

   /**
    * Get the document position of the token at the
    * TokenIterator's current position.
    */
   this.getCurrentTokenPosition = function()
   {
      return {
         row: this.getCurrentTokenRow(),
         column: this.getCurrentTokenColumn()
      };
   };

   this.getCurrentTokenRange = function()
   {
      var start = this.getCurrentTokenPosition();
      var end = {
         row: start.row,
         column: start.column + this.getCurrentToken().value.length
      };

      return Range.fromPoints(start, end);
   };

   function $moveToMatchingToken(cursor, getter, mover, lhs, rhs)
   {
      var balance = 1;
      var token;
      var entity;

      var clone = cursor.clone();

      while ((token = mover.call(clone))) {
         entity = getter(token);
         if (entity === rhs) {
            balance--;
            if (balance === 0) {
               cursor.moveToTokenIterator(clone);
               return true;
            }
         } else if (entity === lhs) {
            balance++;
         }
      }

      return false;

   }

   /**
    * Move forward to the 'matching' token for the current token.
    * This amounts to moving from an opening bracket to the matching
    * closing bracket (if found), or moving forward to a token with
    * a matching type.
    */
   this.fwdToMatchingToken = function()
   {
      var token = this.getCurrentToken();
      if (isOpeningBracket(token.value, true)) {
         return $moveToMatchingToken(
               this,
               function(token) { return token.value;  },
               this.moveToNextToken,
               token.value,
               getComplement(token.value)
         );

      } else if (token.type === "support.function.codebegin") {
         return $moveToMatchingToken(
               this,
               function(token) { return token.type; },
               this.moveToNextToken,
               "support.function.codebegin",
               "support.function.codeend"
         );
      }
      return false;
   };

   this.bwdToMatchingToken = function()
   {
      var token = this.getCurrentToken();
      if (isClosingBracket(token.value, true)) {
         return $moveToMatchingToken(
               this,
               function(token) { return token.value; },
               this.moveToPreviousToken,
               token.value,
               getComplement(token.value)
         );

      } else if (token.type === "support.function.codeend") {
         return $moveToMatchingToken(
               this,
               function(token) { return token.type; },
               this.moveToPreviousToken,
               "support.function.codeend",
               "support.function.codebegin"
         );
      }
      return false;
   };

   this.findTokenValueBwd = function(value, skipMatching)
   {
      skipMatching = !!skipMatching;

      do
      {
         if (skipMatching && this.bwdToMatchingToken())
            continue;

         var token = this.getCurrentToken();
         if (token.value === value)
            return true;

      } while (this.moveToPreviousToken());

      return false;
   };

   this.findTokenValueFwd = function(value, skipMatching)
   {
      skipMatching = !!skipMatching;

      do
      {
         if (skipMatching && this.fwdToMatchingToken())
            continue;

         var token = this.getCurrentToken();
         if (token.value === value)
            return true;

      } while (this.moveToNextToken());

      return false;
   };

   this.findTokenTypeBwd = function(type, skipMatching)
   {
      skipMatching = !!skipMatching;

      do
      {
         if (skipMatching && this.bwdToMatchingToken())
            continue;

         var token = this.getCurrentToken();
         if (token.type === type)
            return true;

      } while (this.moveToPreviousToken());

      return false;
   };

   this.findTokenTypeFwd = function(type, skipMatching)
   {
      skipMatching = !!skipMatching;

      do
      {
         if (skipMatching && this.fwdToMatchingToken())
            continue;

         var token = this.getCurrentToken();
         if (token.type === type)
            return true;

      } while (this.moveToNextToken());

      return false;
   };


}).call(TokenIterator.prototype);

});
/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("ace/token_tooltip", ["require", "exports", "module"], function(require, exports, module) {

var dom = require("ace/lib/dom");
var oop = require("ace/lib/oop");
var event = require("ace/lib/event");
var Range = require("ace/range").Range;
var Tooltip = require("ace/tooltip").Tooltip;

function TokenTooltip (editor) {
    if (editor.tokenTooltip)
        return;
    Tooltip.call(this, editor.container);
    editor.tokenTooltip = this;
    this.editor = editor;

    this.update = this.update.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseOut = this.onMouseOut.bind(this);
    event.addListener(editor.renderer.scroller, "mousemove", this.onMouseMove);
    event.addListener(editor.renderer.content, "mouseout", this.onMouseOut);
}

oop.inherits(TokenTooltip, Tooltip);

(function(){
    this.token = {};
    this.range = new Range();
    
    this.update = function() {
        this.$timer = null;
        
        var r = this.editor.renderer;
        if (this.lastT - (r.timeStamp || 0) > 1000) {
            r.rect = null;
            r.timeStamp = this.lastT;
            this.maxHeight = window.innerHeight;
            this.maxWidth = window.innerWidth;
        }

        var canvasPos = r.rect || (r.rect = r.scroller.getBoundingClientRect());
        var offset = (this.x + r.scrollLeft - canvasPos.left - r.$padding) / r.characterWidth;
        var row = Math.floor((this.y + r.scrollTop - canvasPos.top) / r.lineHeight);
        var col = Math.round(offset);

        var screenPos = {row: row, column: col, side: offset - col > 0 ? 1 : -1};
        var session = this.editor.session;
        var docPos = session.screenToDocumentPosition(screenPos.row, screenPos.column);
        var token = session.getTokenAt(docPos.row, docPos.column);

        if (!token && !session.getLine(docPos.row)) {
            token = {
                type: "",
                value: "",
                state: session.bgTokenizer.getState(0)
            };
        }
        if (!token) {
            session.removeMarker(this.marker);
            this.hide();
            return;
        }

        var state = JSON.stringify(session.getState(row));
        var tokenText = state + "| " + token.type;

        if (this.tokenText != tokenText) {
            this.setText(tokenText);
            this.width = this.getWidth();
            this.height = this.getHeight();
            this.tokenText = tokenText;
        }

        this.show(null, this.x, this.y);

        this.token = token;
        session.removeMarker(this.marker);
        this.range = new Range(docPos.row, token.start, docPos.row, token.start + token.value.length);
        this.marker = session.addMarker(this.range, "ace_bracket", "text");
    };
    
    this.onMouseMove = function(e) {
        this.x = e.clientX;
        this.y = e.clientY;
        if (this.isOpen) {
            this.lastT = e.timeStamp;
            this.setPosition(this.x, this.y);
        }
        if (!this.$timer)
            this.$timer = setTimeout(this.update, 100);
    };

    this.onMouseOut = function(e) {
        if (e && e.currentTarget.contains(e.relatedTarget))
            return;
        this.hide();
        this.editor.session.removeMarker(this.marker);
        this.$timer = clearTimeout(this.$timer);
    };

    this.setPosition = function(x, y) {
        if (x + 10 + this.width > this.maxWidth)
            x = window.innerWidth - this.width - 10;
        if (y > window.innerHeight * 0.75 || y + 20 + this.height > this.maxHeight)
            y = y - this.height - 30;

        Tooltip.prototype.setPosition.call(this, x + 10, y + 20);
    };

    this.destroy = function() {
        this.onMouseOut();
        event.removeListener(this.editor.renderer.scroller, "mousemove", this.onMouseMove);
        event.removeListener(this.editor.renderer.content, "mouseout", this.onMouseOut);
        delete this.editor.tokenTooltip;
    };

}).call(TokenTooltip.prototype);

exports.TokenTooltip = TokenTooltip;

});
/*
 * auto_brace_insert.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/auto_brace_insert", ["require", "exports", "module"], function(require, exports, module)
{
   var Range = require("ace/range").Range;
   var TextMode = require("ace/mode/text").Mode;

   function isCursorWithinCompatibleMatchingParens(session, position, prevChar, currentChar)
   {
      // Don't place closing parenthesis for function argument lists on its own line.
      var token = session.getTokenAt(position.row, position.column - 1);
      if (token && token.value === 'function')
         return false;

      return (
         prevChar === "{" && currentChar === "}" ||
         prevChar === "(" && currentChar === ")" ||
         prevChar === "[" && currentChar === "]"
      );
   }
   

   (function() {

      // modes can override these to provide for
      // auto-pairing of other kinds of tokens
      this.$complements = {
         "(": ")",
         "[": "]",
         '"': '"',
         "{": "}"
      };

      this.$reOpen = /^[(["{]$/;
      this.$reClose = /^[)\]"}]$/;

      // reStop is the set of characters before which we allow ourselves to
      // automatically insert a closing paren. If any other character
      // immediately follows the cursor we will NOT do the insert.
      this.$reStop = /^[;,\s)\]}]$/;

      this.wrapInsert = function(session, __insert, position, text)
      {
         if (!this.insertMatching)
            return __insert.call(session, position, text);

         var cursor = session.selection.getCursor();
         var typing = session.selection.isEmpty() &&
                      position.row == cursor.row &&
                      position.column == cursor.column;

         if (typing) {

            var postRng = Range.fromPoints(position, {
               row: position.row,
               column: position.column + 1
            });

            var postChar = session.doc.getTextRange(postRng);
            if (this.$reClose.test(postChar) && postChar == text) {
               session.selection.moveCursorTo(postRng.end.row,
                                              postRng.end.column,
                                              false);
               return;
            }
         }

         var prevChar = null;
         if (typing)
         {
            var rangeBegin = this.$moveLeft(session.doc, position);
            prevChar = session.doc.getTextRange(Range.fromPoints(rangeBegin,
                                                                 position));
         }

         var endPos = __insert.call(session, position, text);

         // Is this an open paren?
         if (typing && this.$reOpen.test(text)) {

            // Is the next char not a character or number?
            var nextCharRng = Range.fromPoints(endPos, {
               row: endPos.row,
               column: endPos.column + 1
            });

            var nextChar = session.doc.getTextRange(nextCharRng);
            if (this.$reStop.test(nextChar) || nextChar.length == 0) {
               if (this.allowAutoInsert(session, endPos, this.$complements[text])) {
                  session.doc.insert(endPos, this.$complements[text]);
                  session.selection.moveCursorTo(endPos.row, endPos.column, false);
               }
            }
         }

         else if (typing && text === "\n") {

            var rangeEnd = this.$moveRight(session.doc, endPos);
            var currentChar = session.doc.getTextRange(Range.fromPoints(endPos, rangeEnd));
            if (isCursorWithinCompatibleMatchingParens(session, position, prevChar, currentChar))
            {
               var indent;
               if (this.getIndentForOpenBrace)
                  indent = this.getIndentForOpenBrace(this.$moveLeft(session.doc, position));
               else
                  indent = this.$getIndent(session.doc.getLine(endPos.row - 1));

               session.doc.insert(endPos, "\n" + indent);
               session.selection.moveCursorTo(endPos.row, endPos.column, false);
            }
         }

         return endPos;
      };

      this.allowAutoInsert = function(session, pos, text)
      {
         return session.renderer.$ghostText == null;
      };

      // To enable this, call "this.allowAutoInsert = this.smartAllowAutoInsert"
      // in the mode subclass
      this.smartAllowAutoInsert = function(session, pos, text)
      {
         if (session.renderer.$ghostText != null)
            return false;

         // Always allow auto-insert for other insertion types
         if (text !== "'" && text !== '"' && text !== '`')
            return true;

         // Only allow auto-insert of a '`' character if the number of
         // backticks on the line is not balanced. Note that this is an
         // R-centric view of backquoted strings, and assumes things within
         // can be escaped by \.
         if (text === '`')
         {
            // get line up to cursor position
            var start = {row: pos.row, column: 0};
            var line = session.doc.getTextRange({start: start, end: pos});

            // remove escaped characters from the line
            line = line.replace(/\\./g, '');

            // check count of '`' characters
            var match = line.match(/`/g);
            return (match.length % 2) != 0;
         }

         // Only allow auto-insertion of a quote char if the actual character
         // that was typed, was the start of a new string token
         if (pos.column == 0)
            return true;

         var token = this.codeModel.getTokenForPos(pos, false, true);
         return token &&
                token.type === 'string' &&
                token.column === pos.column - 1;
      };

      this.wrapRemove = function(editor, __remove, dir)
      {
         var cursor = editor.selection.getCursor();
         var doc = editor.session.getDocument();

         // Here are some easy-to-spot reasons why it might be impossible for us
         // to need our special deletion logic.
         if (!this.insertMatching ||
             dir != "left" ||
             !editor.selection.isEmpty() ||
             editor.$readOnly ||
             cursor.column == 0 ||     // hitting backspace at the start of line
             doc.getLine(cursor.row).length <= cursor.column) {

            return __remove.call(editor, dir);
         }

         var leftRange = Range.fromPoints(this.$moveLeft(doc, cursor), cursor);
         var rightRange = Range.fromPoints(cursor, this.$moveRight(doc, cursor));
         var leftText = doc.getTextRange(leftRange);

         var deleteRight = this.$reOpen.test(leftText) &&
                           this.$complements[leftText] == doc.getTextRange(rightRange);

         __remove.call(editor, dir);
         if (deleteRight)
            __remove.call(editor, 'right');
      };

      this.$moveLeft = function(doc, pos)
      {
         if (pos.row == 0 && pos.column == 0)
            return pos;

         var row = pos.row;
         var col = pos.column;

         if (col)
            col--;
         else
         {
            row--;
            col = doc.getLine(row).length;
         }
         return {row: row, column: col};
      };

      this.$moveRight = function(doc, pos)
      {
         var row = pos.row;
         var col = pos.column;

         if (doc.getLine(row).length != col)
            col++;
         else
         {
            row++;
            col = 0;
         }

         if (row >= doc.getLength())
            return pos;
         else
            return {row: row, column: col};
      };
   }).call(TextMode.prototype);

   exports.setInsertMatching = function(insertMatching) {
      TextMode.prototype.insertMatching = insertMatching;
   };

});
/*
 * c_cpp.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *      Gastón Kleiman <gaston.kleiman AT gmail DOT com>
 *
 * Based on Bespin's C/C++ Syntax Plugin by Marc McIntyre.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/c_cpp", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var Range = require("ace/range").Range;
var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
var c_cppHighlightRules = require("mode/c_cpp_highlight_rules").c_cppHighlightRules;

var CppMatchingBraceOutdent = require("mode/c_cpp_matching_brace_outdent").CppMatchingBraceOutdent;
var CStyleBehaviour = require("mode/behaviour/cstyle").CStyleBehaviour;

var CppStyleFoldMode = null;
if (!window.NodeWebkit) {
   CppStyleFoldMode = require("mode/c_cpp_fold_mode").FoldMode;
}

var RCodeModel = require("mode/r_code_model").RCodeModel;
var RMatchingBraceOutdent = require("mode/r_matching_brace_outdent").RMatchingBraceOutdent;

var CppCodeModel = require("mode/cpp_code_model").CppCodeModel;

var TokenCursor = require("mode/token_cursor").TokenCursor;

var Utils = require("mode/utils");

var Mode = function(suppressHighlighting, session) {

   // Keep references to current session, document
   this.$session = session;
   this.$doc = session.getDocument();

   // Only need one tokenizer for the document (we assume other rules
   // have been properly embedded)
   this.$tokenizer = new Tokenizer(new c_cppHighlightRules().getRules());

   // R-related tokenization
   this.r_codeModel = new RCodeModel(
      session,
      this.$tokenizer,
      /^r-/,
      /^\s*\/\*{3,}\s*([Rr])\s*$/,
      /^\s*\*+\//
   );
   this.$r_outdent = new RMatchingBraceOutdent(this.r_codeModel);

   // C/C++ related tokenization
   this.codeModel = new CppCodeModel(session, this.$tokenizer);
   
   this.$behaviour = new CStyleBehaviour(this.codeModel);
   this.$cpp_outdent = new CppMatchingBraceOutdent(this.codeModel);
   
   if (!window.NodeWebkit)     
      this.foldingRules = new CppStyleFoldMode();

   this.$tokens = this.codeModel.$tokens;
   this.getLineSansComments = this.codeModel.getLineSansComments;

};
oop.inherits(Mode, TextMode);

(function() {

   // We define our own 'wrapInsert', 'wrapRemove' functions that
   // delegate directly back to the editor / session -- this is
   // because we don't want to inherit the automatic matching brace
   // behaviour. Note that it is attached to the TextMode prototype by
   // 'matching_brace_outdent.js' and called through the wrappers set
   // in 'loader.js'.
   this.wrapInsert = function(session, __insert, position, text) {
      if (!this.cursorInRLanguageMode())
         return __insert.call(session, position, text);
      else
         return TextMode.prototype.wrapInsert(session, __insert, position, text);
   };

   this.wrapRemove = function(editor, __remove, dir) {
      if (!this.cursorInRLanguageMode())
         return __remove.call(editor, dir);
      else
         return TextMode.prototype.wrapRemove(editor, __remove, dir);
   };

   var that = this;

   this.insertChunkInfo = {
      value: "/*** R\n\n*/\n",
      position: {row: 1, column: 0},
      content_position: {row: 1, column: 0}
   };

   this.toggleCommentLines = function(state, doc, startRow, endRow) {
      var outdent = true;
      var re = /^(\s*)\/\//;

      for (var i = startRow; i <= endRow; i++) {
         if (!re.test(doc.getLine(i))) {
            outdent = false;
            break;
         }
      }

      if (outdent) {
         var deleteRange = new Range(0, 0, 0, 0);
         for (var i = startRow; i <= endRow; i++)
         {
            var line = doc.getLine(i);
            var m = line.match(re);
            deleteRange.start.row = i;
            deleteRange.end.row = i;
            deleteRange.end.column = m[0].length;
            doc.replace(deleteRange, m[1]);
         }
      } else {
         doc.indentRows(startRow, endRow, "//");
      }
   };

   this.getLanguageMode = function(position)
   {
      var state = Utils.getPrimaryState(this.$session, position.row);
      return state.match(/^r-/) ? 'R' : 'C_CPP';
   };

   this.cursorInRLanguageMode = function()
   {
      return this.getLanguageMode(this.$session.getSelection().getCursor()) === "R";
   };

   this.inRLanguageMode = function(state)
   {
     if (!state)
        return null;

     if (typeof(state) === "object" && state.hasOwnProperty("length") && state.length > 0) {
        state = state[0];
     }
     return state.match(/^r-/);
   };

   this.getNextLineIndent = function(state, line, tab, row, dontSubset)
   {
      state = Utils.primaryState(state);
      // Defer to the R language indentation rules when in R language mode
      if (this.inRLanguageMode(state))
         return this.r_codeModel.getNextLineIndent(state, line, tab, row);
      else
         return this.codeModel.getNextLineIndent(state, line, tab, row, dontSubset);
   };

   this.checkOutdent = function(state, line, input) {
      if (this.inRLanguageMode(state))
         return this.$r_outdent.checkOutdent(state, line, input);
      else
         return this.$cpp_outdent.checkOutdent(state, line, input);
   };

   this.autoOutdent = function(state, doc, row) {
      if (this.inRLanguageMode(state))
         return this.$r_outdent.autoOutdent(state, doc, row, this.r_codeModel);
      else
         return this.$cpp_outdent.autoOutdent(state, doc, row);
   };

   this.$transformAction = this.transformAction;
   this.transformAction = function(state, action, editor, session, param) {
      state = Utils.primaryState(state);
      if (this.inRLanguageMode(state)) {
         // intentionally left blank -- this behaviour is handled elsewhere
         // in the code base
      } else {
         return this.$transformAction(state, action, editor, session, param);
      }
   };

   this.$id = "mode/c_cpp";

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * c_cpp_fold_mode.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *      Gastón Kleiman <gaston.kleiman AT gmail DOT com>
 *
 * Based on Bespin's C/C++ Syntax Plugin by Marc McIntyre.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */


define("mode/c_cpp_fold_mode", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Range = require("ace/range").Range;
var BaseFoldMode = require("ace/mode/folding/fold_mode").FoldMode;

var FoldMode = exports.FoldMode = function() {};
oop.inherits(FoldMode, BaseFoldMode);

(function() {

    var reBracketStart = /(\{|\[)[^\}\]]*$/;
    var reBracketEnd   = /^[^\[\{]*(\}|\])/;

    this.getFoldWidget = function(session, foldStyle, row) {

        var FOLD_NONE = "";
        var FOLD_START = "start";
        var FOLD_END = foldStyle === "markbeginend" ? "end" : "";

        var line = session.getLine(row);

        if (reBracketStart.test(line))
            return FOLD_START;

        if (reBracketEnd.test(line))
            return FOLD_END;

        var commentStartIdx = line.indexOf("/*");
        var commentEndIdx = line.indexOf("*/");

        if (commentStartIdx !== -1 && (commentEndIdx === -1 || commentStartIdx > commentEndIdx))
            return FOLD_START;

        if (commentEndIdx !== -1 && (commentStartIdx === -1 || commentEndIdx < commentStartIdx))
            return FOLD_END;

        return FOLD_NONE;

    };

    function getBlockCommentRange(session, startRow, startColumn, delta)
    {
        var lines = session.doc.$lines;
        var row = startRow + delta;
        var line = lines[row];
        var target = delta > 0 ? "*/" : "/*";

        var range;
        while (line != null)
        {
            var idx = line.indexOf(target);
            if (idx !== -1)
            {
                range = delta > 0 ?
                    new Range(startRow, startColumn, row, idx) :
                    new Range(row, line.length, startRow, startColumn);
                break;
            }

            row += delta;
            line = lines[row];
        }

        return range;
    }

    function findChunkRange(session, startRow, startColumn, targetType, delta)
    {
        var row = startRow + delta;
        var lines = session.doc.$lines;

        while (row >= 0 && row < session.getLength())
        {
            var tokens = session.getTokens(row);
            var line = lines[row];
            for (var i = 0; i < tokens.length; i++)
            {
                var token = tokens[i];
                if (token.type === targetType)
                {
                    return delta > 0 ?
                        new Range(startRow, startColumn, row, 0) :
                        new Range(row, line.length, startRow, startColumn);
                }
            }

            row += delta;
        }
    }

    this.getFoldWidgetRange = function(session, foldStyle, row) {

        var line = session.getLine(row);
        var match;

        // First, check for brackets for folding.
        match = line.match(reBracketStart);
        if (match)
            return this.openingBracketBlock(session, match[1], row, match.index);

        match = foldStyle === "markbeginend" && line.match(reBracketEnd);
        if (match)
            return this.closingBracketBlock(session, match[1], row, match.index + match[0].length);

        // Check for chunk headers / footers.
        var tokens = session.getTokens(row);
        for (var i = 0; i < tokens.length; i++)
        {
            var token = tokens[i];
            if (token.type === "support.function.codebegin")
                return findChunkRange(session, row, line.length, "support.function.codeend", 1);
            else if (token.type === "support.function.codeend")
                return findChunkRange(session, row, 0, "support.function.codebegin", -1);
        }

        // Next, check for block comment folds.
        var idx;

        idx = line.indexOf("/*");
        if (idx !== -1)
            return getBlockCommentRange(session, row, line.length, 1);

        idx = line.indexOf("*/");
        if (idx !== -1)
            return getBlockCommentRange(session, row, idx, -1);

        // No match -- just return undefined.
    };

}).call(FoldMode.prototype);

});
/*
 * c_cpp_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *      Gastón Kleiman <gaston.kleiman AT gmail DOT com>
 *
 * Based on Bespin's C/C++ Syntax Plugin by Marc McIntyre.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/c_cpp_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var DocCommentHighlightRules = require("mode/doc_comment_highlight_rules").DocCommentHighlightRules;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var TexHighlightRules = require("mode/tex_highlight_rules").TexHighlightRules;
var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
var RainbowParenHighlightRules = require("mode/rainbow_paren_highlight_rules").RainbowParenHighlightRules;

var c_cppHighlightRules = function() {

   function escapeRegExp(str) {
      return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
   }

   // See: http://en.cppreference.com/w/cpp/keyword. Note that
   // 'operatorYY' keywords are highlighted separately below.
   var keywords = lang.arrayToMap([
      "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand",
      "bitor", "bool", "break", "case", "catch", "char", "char16_t",
      "char32_t", "class", "compl", "const", "constexpr",
      "const_cast", "continue", "decltype", "default", "delete",
      "do", "double", "dynamic_cast", "else", "enum", "explicit",
      "export", "extern", "false", "float", "for", "friend", "goto",
      "if", "inline", "int", "in", "long", "mutable", "namespace",
      "new", "noexcept", "not", "not_eq", "nullptr", "or", "or_eq",
      "private", "protected", "public", "register", "reinterpret_cast",
      "return", "short", "signed", "sizeof", "sizeof...",
      "static", "static_assert", "static_cast", "struct", "switch",
      "template", "this", "thread_local", "throw", "true", "try",
      "typedef", "typeid", "typeof", "typename", "union", "unsigned",
      "using", "virtual", "void", "volatile", "wchar_t", "while",
      "xor", "xor_eq"
   ]);

   var preProcTokens = [
      "include", "pragma", "line", "define", "defined", "undef", "ifdef",
      "ifndef", "if", "else", "elif", "endif", "warning", "error"
   ];

   var buildinConstants = lang.arrayToMap(
      ("NULL").split("|")
   );

   var operatorTokens = [

      "new", "delete",

      ">>=", "<<=", "->*", "...",
      
      "<<", ">>", "&&", "||", "==", "!=", "<=", ">=", "::", "*=",
      "+=", "-=", "/=", "++", "--", "&=", "^=", "%=", "->", ".*",
      
      "!", "$", "&", "|", "+", "-", "*", "/", "^", "~", "=", "%"
      
   ];

   var reOperatorTokens = operatorTokens.map(function(x) {
      return escapeRegExp(x);
   }).join("|");

   var reOperator =
      ["->*"]
      .concat(operatorTokens)
      .concat(["<", ">", ",", "()", "[]", "->"])
      .map(function(x) {
         return escapeRegExp(x);
      });

   reOperator = ["new\\s*\\[\\]", "delete\\s*\\[\\]"].concat(reOperator);
   reOperator = "operator\\s*(?:" + reOperator.join("|") + ")|operator\\s+[\\w_]+(?:&&|&|\\*)?";

   // regexp must not have capturing parentheses. Use (?:) instead.
   // regexps are ordered -> the first match is used

   this.$rules = {
      "start" : [
         {
            // Comment Attributes
            token: "comment.doc.tag",
            regex: "\\/\\/\\s*\\[\\[.*\\]\\].*$"
         }, {
            // C++11 Attributes
            token: "comment.doc.tag",
            regex: "^\\s*\\[\\[(.*)\\]\\]"
         }, {
            // Roxygen
            token : "comment",
            regex : "\\/\\/'",
            next : "rdoc-start"
         }, {
            // Standard comment
            token : "comment",
            regex : "\\/\\/.*$"
         },
         DocCommentHighlightRules.getStartRule("doc-start"),
         {
            token : "comment", // multi line comment
            merge : true,
            regex : "\\/\\*",
            next : "comment"
         }, {
            token : "string", // single line
            regex : '(?:R|L|u8|u|U)?["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]'
         }, {
            token : "string", // multi line string start
            merge : true,
            regex : '(?:R|L|u8|u|U)?["].*\\\\$',
            next : "qqstring"
         }, {
            token : "string", // single line
            regex : "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']"
         }, {
            token : "string", // multi line string start
            merge : true,
            regex : "['].*\\\\$",
            next : "qstring"
         }, {
            token : "constant.numeric", // hex
            regex : "0[xX][0-9a-fA-F]+\\b"
         }, {
            token : "constant.numeric", // binary literal
            regex : "0[bB][01']+\\b"
         }, {
            token : "constant.numeric", // float
            regex : "[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?(?:(?:[fF])|(?:(?:[uU]?(?:(?:l?l?)|(?:L?L?))?)|(?:(?:(?:l?l?)|(?:L?L?))[uU]?))|(?:_\\w+))?\\b"
         }, {
            token : "keyword.preproc",
            regex : "#\\s*include\\b",
            next : "include"
         }, {
            token : "keyword.preproc", // pre-compiler directives
            regex : "(?:" + preProcTokens.map(function(x) { return "#\\s*" + x + "\\b"; }).join("|") + ")"
         }, {
            token : "variable.language", // compiler-specific constructs
            regex : "\\b__\\S+__\\b"
         }, {
            token: "keyword",
            regex: reOperator
         }, {
            token : function(value) {
               if (value == "this")
                  return "variable.language";
               else if (keywords.hasOwnProperty(value))
                  return "keyword";
               else if (buildinConstants.hasOwnProperty(value))
                  return "constant.language";
               else
                  return "identifier";
            },
            regex : "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
         }, {
            token : "keyword.operator",
            merge : false,
            regex : reOperatorTokens
         }, {
            token : "keyword.punctuation.operator",
            merge : false,
            regex : "\\?|\\:|\\,|\\;|\\.|\\\\"
         },
         RainbowParenHighlightRules.getParenRule(),
         {
             token : "paren.keyword.operator",
             merge : false,
             regex : "[<>]"
          }, {
             token : "text",
             regex : "\\s+"
          }
      ],
      "comment" : [
         {
            token : "comment", // closing comment
            regex : ".*?\\*\\/",
            next : "start"
         }, {
            token : "comment", // comment spanning whole line
            merge : true,
            regex : ".+"
         }
      ],
      "qqstring" : [
         {
            token : "string",
            regex : '(?:(?:\\\\.)|(?:[^"\\\\]))*?"',
            next : "start"
         }, {
            token : "string",
            merge : true,
            regex : '.+'
         }
      ],
      "qstring" : [
         {
            token : "string",
            regex : "(?:(?:\\\\.)|(?:[^'\\\\]))*?'",
            next : "start"
         }, {
            token : "string",
            merge : true,
            regex : '.+'
         }
      ],
      "include" : [
         {
            token : "string", // <CONSTANT>
            regex : /<.+>/,
            next : "start"
         },
         {
            token : "string",
            regex : /\".+\"/,
            next : "start"
         }
      ]
      
   };

   var rdRules = new TexHighlightRules("comment").getRules();

   // Make all embedded TeX virtual-comment so they don't interfere with
   // auto-indent.
   for (var i = 0; i < rdRules["start"].length; i++) {
      rdRules["start"][i].token += ".virtual-comment";
   }

   this.addRules(rdRules, "rdoc-");
   this.$rules["rdoc-start"].unshift({
      token: "text",
      regex: "^",
      next: "start"
   });
   this.$rules["rdoc-start"].unshift({
      token : "keyword",
      regex : "@(?!@)[^ ]*"
   });
   this.$rules["rdoc-start"].unshift({
      token : "comment",
      regex : "@@"
   });
   this.$rules["rdoc-start"].push({
      token : "comment",
      regex : "[^%\\\\[({\\])}]+"
   });

   this.embedRules(DocCommentHighlightRules, "doc-",
                   [ DocCommentHighlightRules.getEndRule("start") ]);

   // Embed R syntax highlighting
   this.$rules["start"].unshift({
      token: "support.function.codebegin",
      regex: "^\\s*\\/\\*{3,}\\s*[Rr]\\s*$",
      next: "r-start"
   });

   var rRules = new RHighlightRules().getRules();
   this.addRules(rRules, "r-");
   this.$rules["r-start"].unshift({
      token: "support.function.codeend",
      regex: "\\*\\/",
      next: "start"
   });
};

oop.inherits(c_cppHighlightRules, TextHighlightRules);

exports.c_cppHighlightRules = c_cppHighlightRules;
});
define("mode/c_cpp_matching_brace_outdent", ["require", "exports", "module"], function(require, exports, module) {

var Range = require("ace/range").Range;

var CppTokenCursor = require("mode/token_cursor").CppTokenCursor;
var CppMatchingBraceOutdent = function(codeModel) {
   this.codeModel = codeModel;
};
var Utils = require("mode/utils");

// Allow the user to control various levels of outdenting if desired
var $outdentColon              = true; // : (initializer list)
var $outdentRightParen         = true; // )
var $outdentLeftBrace          = true; // {
var $outdentRightBrace         = true; // }
var $outdentRightBracket       = true; // ]
var $outdentRightArrow         = true; // >
var $alignDots                 = true; // .
var $alignEquals               = true; // int x = 1,
                                       //     y = 2;
var $alignStreamIn             = true; // >>
var $alignStreamOut            = true; // <<
var $alignClassAccessModifiers = true; // public: etc.
var $alignCase                 = true; // case 'a':

(function() {

   // Set the indent of the line at 'row' to the indentation at
   // 'rowFrom'. This operation is only performed if the indentation
   // of the lines at 'rowTo' and 'rowFrom' match.
   //
   // 'predicate' is an (optional) function taking the old and new
   // indents, and returning true or false -- this is used to ensure
   // outdenting only occurs when explicitly desired.
   this.setIndent = function(session, rowTo, rowFrom, extraIndent, predicate) {

      var doc = session.getDocument();
      extraIndent = typeof extraIndent === "string" ?
         extraIndent :
         "";

      var line = doc.$lines[rowTo];
      var prevLine = doc.$lines[rowFrom];

      var oldIndent = this.$getIndent(line);
      var newIndent = this.$getIndent(prevLine);

      if (typeof predicate !== "function" || predicate(oldIndent, newIndent)) {
         doc.replace(
            new Range(rowTo, 0, rowTo, oldIndent.length),
            newIndent + extraIndent
         );
      }
      
   };

   this.checkOutdent = function(state, line, input) {
      
      if (Utils.endsWith(state, "start")) {

         // private: / public: / protected
         // also class initializer lists
         if (input === ":") {
            return true;
         }

         // outdenting for lines starting with 'closers' and 'openers'
         // also preproc lines
         if (/^\s*[#\{\}\>\]\)<.:]/.test(input))
            return true;

         // outdenting for '='
         if (input === "=")
            return true;

      }

      // check for nudging of '/' to the left (?)
      if (Utils.endsWith(state, "comment")) {

         if (input == "/") {
            return true;
         }

      }

      return false;

   };

   this.escapeRegExp = function(string) {
      return string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
   };

   this.alignStartToken = function(token, session, row, line, prevLine) {

      if (prevLine === null || line === null) return false;
      var regex = new RegExp("^\\s*" + this.escapeRegExp(token));
      if (regex.test(line)) {
         var index = prevLine.indexOf(token);
         if (index >= 0) {

            var doc = session.getDocument();
            var oldIndent = this.$getIndent(line);
            var newIndent = new Array(index + 1).join(" ");

            doc.replace(
               new Range(row, 0, row, oldIndent.length),
               newIndent
            );

            return true;
         }
      }
      return false;
   };

   this.alignEquals = function(session, row, line, prevLine) {

      if (prevLine === null || line === null) return false;
      var equalsIndex = line.indexOf("=");

      // Bail if there is more than one '=' on the line
      if (equalsIndex !== line.lastIndexOf("="))
         return false;
      
      var prevLineEqualsIndex = prevLine.indexOf("=");
      if (equalsIndex !== -1 && prevLineEqualsIndex !== -1 && /,\s*$/.test(prevLine))
      {
         var doc = session.getDocument();
         var oldIndent = this.$getIndent(line);
         if (oldIndent.length >= prevLineEqualsIndex)
            return false;

         var diff = prevLineEqualsIndex - equalsIndex;
         if (diff <= 0)
            return false;

         var newIndent = new Array(oldIndent.length + diff + 1).join(" ");

         doc.replace(
            new Range(row, 0, row, oldIndent.length),
            newIndent
         );

         return true;
         
      }

      return false;
      
   };

   this.autoOutdent = function(state, session, row) {

      var doc = session.doc;
      var line = doc.getLine(row);
      var prevLine = null;
      if (row > 0)
         prevLine = doc.getLine(row - 1);

      // Check for '<<', '.'alignment
      if ($alignStreamOut && this.alignStartToken("<<", session, row, line, prevLine))
         return;

      if ($alignStreamIn && this.alignStartToken(">>", session, row, line, prevLine))
         return;

      if ($alignDots && this.alignStartToken(".", session, row, line, prevLine))
         return;

      // if ($alignEquals && this.alignEquals(session, row, line, prevLine))
      //    return;

      // Outdent for a ':' places on its own line if it appears the
      // user is creating an initialization list for
      // a constructor, e.g.
      //
      //     SomeConstructor(int a,
      //                     int b)
      //         :
      //         ^
      //
      // We also perform a similar action for class inheritance, e.g.
      //
      //     class Foo
      //         :
      if ($outdentColon &&
          /^\s*:/.test(doc.getLine(row)) &&
          !/^\s*::/.test(doc.getLine(row))) {

         if (this.codeModel.$tokenUtils.$tokenizeUpToRow(row)) {

            var tokenCursor = new CppTokenCursor(this.codeModel.$tokens, row, 0);
            var rowToUse = -1;

            // First, handle constructors. Note that we need to first walk
            // over some keywords, e.g.
            //
            //     int foo(int a, int b) const noexcept()
            //         :
            //
            var clone = tokenCursor.cloneCursor();
            if (clone.peekBwd().currentValue() === ")" ||
                clone.peekBwd().currentType() === "keyword")
            {
               do {
                  
                  var type = clone.currentType();
                  var value = clone.currentValue();

                  // Stop conditions
                  if (type === "identifier" ||
                      value === ";")
                  {
                     rowToUse = clone.$row;
                     break;
                  }

                  // Chomp keywords
                  if (type === "keyword") {
                     continue;
                  }

                  // Walk over parens
                  clone.bwdToMatchingToken();
                  
               } while (clone.moveToPreviousToken());

            }

            // Otherwise, try walking over class inheritance
            else {
               tokenCursor.moveToPreviousToken();
               if (tokenCursor.bwdOverClassySpecifiers()) {
                  rowToUse = tokenCursor.$row;
               }
            }
            
            if (rowToUse >= 0) {
               this.setIndent(session, row, rowToUse, session.getTabString(),
                              function(oldIndent, newIndent) {
                                 return oldIndent === newIndent;
                              });
            }

         }
      }

      // Outdent for lines starting with a '>' if an associated matching
      // token can be found. This is intended for template contexts, e.g.
      //
      //     template <
      //         int RTYPE
      //     >
      //     ^
      //
      if ($outdentRightArrow &&
          /^\s*>/.test(line) &&
          !/^\s*>>/.test(line)) {

         var rowToUse = this.codeModel.getRowForMatchingEOLArrows(session, doc, row);
         if (rowToUse >= 0) {
            this.setIndent(session, row, rowToUse);
            return;
         }

         // TODO: Renable this block if we get better tokenization
         // (need to discover whether '<', '>' are operators or not)
         //
         // if (this.codeModel.$tokenUtils.$tokenizeUpToRow(row)) {
         //    var tokenCursor = new CppTokenCursor(this.codeModel.$tokens, row, 0);
         //    if (tokenCursor.bwdToMatchingArrow()) {
         //       this.setIndent(session, row, tokenCursor.$row);
         //    }
         // }
         
      }

      // Outdent for closing braces (to match the indentation of their
      // matched opening brace
      //
      // If the line on which the matching '{' was found is of
      // the form
      //
      //  foo) {
      //
      // then indent according to the location of the matching
      // '('
      //
      // This rule should apply to closing braces with semi-colons
      // or comments following as well.
      if ($outdentRightBrace && /^\s*\}/.test(line)) {

         var openBracketPos = session.findMatchingBracket({
            row: row,
            column: line.indexOf("}") + 1
         });

         if (openBracketPos !== null) {

            // If the open brace lies on its own line, match its indentation
            var openBracketLine =
                   doc.$lines[openBracketPos.row];

            if (/^\s*\{/.test(openBracketLine)) {
               this.setIndent(session, row, openBracketPos.row);
               return;
            }

            // Otherwise, try looking upwards to get an appropriate indentation
            var heuristicRow = this.codeModel.getRowForOpenBraceIndent(
               session,
               openBracketPos.row
            );

            if (heuristicRow >= 0) {
               this.setIndent(session, row, heuristicRow);
               return;
            }

         } 

      }

      if ($outdentRightParen) {

         var closingParenMatch = /^\s*\)/.exec(line);
         if (closingParenMatch) {
            var openParenPos = session.findMatchingBracket({
               row: row,
               column: line.indexOf(")") + 1
            });
            if (openParenPos) {
               this.setIndent(session, row, openParenPos.row);
               return;
            }
         }
      }

      if ($outdentRightBracket) {

         var closingBracketMatch = /^\s*\]/.exec(line);
         if (closingBracketMatch) {
            var openBracketPos = session.findMatchingBracket({
               row: row,
               column: line.indexOf("]") + 1
            });
            if (openBracketPos) {
               this.setIndent(session, row, openBracketPos.row);
               return;
            }
         }
      }
      
      // If we just typed 'public:', 'private:' or 'protected:',
      // we should outdent if possible. Do so by looking for the
      // enclosing 'class' scope.
      if ($alignClassAccessModifiers &&
          /^\s*public\s*:\s*$|^\s*private\s*:\s*$|^\s*protected\s*:\s*$/.test(line)) {

         // Find the associated open bracket.
         var openBracePos = session.$findOpeningBracket(
            "}",
            {
               row: row,
               column: line.length
            },
            Utils.getTokenTypeRegex("paren")
         );

         if (openBracePos) {
            // If this open brace is already associated with a class or struct,
            // step over all of those rows.
            var heuristicRow =
                   this.codeModel.getRowForOpenBraceIndent(session, openBracePos.row);

            if (heuristicRow >= 0) {
               this.setIndent(session, row, heuristicRow);
               return;
            } else {
               this.setIndent(session, row, openBracePos.row);
               return;
            }
         }
         
      }

      // Similar lookback for 'case foo:'.
      if ($alignCase &&
          (/^\s*case.+:/.test(line) || /^\s*default\s*:/.test(line)))
      {

         // Find the associated open bracket.
         var openBracePos = session.$findOpeningBracket(
            "}",
            {
               row: row,
               column: /(\S)/.exec(line).index + 1
            },
            Utils.getTokenTypeRegex("paren")
         );

         if (openBracePos) {
            var heuristicRow =
                   this.codeModel.getRowForOpenBraceIndent(session, openBracePos.row);

            if (heuristicRow >= 0) {
               this.setIndent(session, row, heuristicRow);
               return;
            } else {
               this.setIndent(session, row, openBracePos.row);
               return;
            }
         }
         
      }
      

      // If we just inserted a '{' on a new line to begin a class definition,
      // try looking up for the associated class statement.
      // We want to look back over the following common indentation styles:
      //
      // (1) class Foo
      //     : public A,
      //       public B,
      //       public C
      //
      // and
      //
      // (2) class Foo
      //     : public A
      //     , public B
      //     , public C
      //
      // We also design the rules to 'work' for initialization lists, e.g.
      //
      //    Foo()
      //    : foo_(foo),
      //      bar_(bar),
      //      baz_(baz)
      if ($outdentLeftBrace && /^\s*\{/.test(line)) {

         // Don't outdent if the previous line ends with a semicolon
         if (!/;\s*$/.test(prevLine)) {

            if (this.codeModel.$tokenUtils.$tokenizeUpToRow(row)) {

               var tokenCursor = new CppTokenCursor(this.codeModel.$tokens);
               tokenCursor.$row = row,
               tokenCursor.$offset = 0;

               if (tokenCursor.moveToPreviousToken()) {
                  if (tokenCursor.currentValue() === "=") {
                     return;
                  }
               }
            }

            var scopeRow = this.codeModel.getRowForOpenBraceIndent(
               session,
               row
            );

            if (scopeRow >= 0) {

               this.setIndent(session, row, scopeRow);
               return;
               
            }

         }

      }

      // For lines intended for the preprocessor, trim off the indentation.
      if (/^\s*#/.test(line))
      {
         var oldIndent = this.$getIndent(line);
         doc.replace(
            new Range(row, 0, row, oldIndent.length),
            ""
         );
         return;
      }

   };

   this.$getIndent = function(line) {
      var match = line.match(/^(\s+)/);
      if (match) {
         return match[1];
      }
      return "";
   };

}).call(CppMatchingBraceOutdent.prototype);

exports.CppMatchingBraceOutdent = CppMatchingBraceOutdent;

exports.getOutdentColon = function() { return $outdentColon; };
exports.setOutdentColon = function(x) { $outdentColon = x; };

exports.getOutdentRightParen = function() { return $outdentRightParen; };
exports.setOutdentRightParen = function(x) { $outdentRightParen = x; };

exports.getOutdentLeftBrace = function() { return $outdentLeftBrace; };
exports.setOutdentLeftBrace = function(x) { $outdentLeftBrace = x; };

exports.getOutdentRightBrace = function() { return $outdentRightBrace; };
exports.setOutdentRightBrace = function(x) { $outdentRightBrace = x; };

exports.getOutdentRightBracket = function() { return $outdentRightBracket; };
exports.setOutdentRightBracket = function(x) { $outdentRightBracket = x; };

exports.getOutdentRightArrow = function() { return $outdentRightArrow; };
exports.setOutdentRightArrow = function(x) { $outdentRightArrow = x; };

exports.getAlignDots = function() { return $alignDots; };
exports.setAlignDots = function(x) { $alignDots = x; };

exports.getAlignEquals = function() { return $alignEquals; };
exports.setAlignEquals = function(x) { $alignEquals = x; };

exports.getAlignStreamIn = function() { return $alignStreamIn; };
exports.setAlignStreamIn = function(x) { $alignStreamIn = x; };

exports.getAlignStreamOut = function() { return $alignStreamOut; };
exports.setAlignStreamOut = function(x) { $alignStreamOut = x; };

exports.getAlignClassAccessModifiers = function() { return $alignClassAccessModifiers; };
exports.setAlignClassAccessModifiers = function(x) { $alignClassAccessModifiers = x; };

exports.getAlignCase = function() { return $alignCase; };
exports.setAlignCase = function(x) { $alignCase = x; };


});
/*
 * c_cpp_style_behaviour.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *      Gastón Kleiman <gaston.kleiman AT gmail DOT com>
 *
 * Based on Bespin's C/C++ Syntax Plugin by Marc McIntyre.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */


define('mode/behaviour/cstyle', ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Behaviour = require("ace/mode/behaviour").Behaviour;
var CppCodeModel = require("mode/cpp_code_model").CppCodeModel;
var CppTokenCursor = require("mode/token_cursor").CppTokenCursor;
var TextMode = require("ace/mode/text").Mode;
var Utils = require("mode/utils");

var $fillinDoWhile = true;

var CStyleBehaviour = function(codeModel) {

   var codeModel = codeModel;
   var $complements = codeModel.$complements;

   var autoPairInsertion = function(text, input, editor, session) {

      var leftChar = text;
      var rightChar = $complements[leftChar];

      if (input == leftChar) {

         var selection = editor.getSelectionRange();
         var selected = session.doc.getTextRange(selection);
         if (selected !== "") {
            return {
               text: leftChar + selected + rightChar,
               selection: false
            };
         } else {
            return {
               text: leftChar + rightChar,
               selection: [1, 1]
            };
         }
      } else if (input == rightChar) {
         var cursor = editor.getCursorPosition();
         var line = session.doc.getLine(cursor.row);
         var cursorRightChar = line[cursor.column];
         if (cursorRightChar == rightChar) {

            // TODO: Workaround for 'findMatchingBracket' failing for '<>'
            if (rightChar === '>')
               return { text: '', selection: [1, 1] };

            var matchPos = session.findMatchingBracket({
               row: cursor.row,
               column: cursor.column + 1
            });
            
            if (matchPos !== null) {
               return {
                  text: '',
                  selection: [1, 1]
               };
            }
         }
      }
      
   };

   var autoPairDeletion = function(text, range, session) {

      var lChar = text;
      var rChar = $complements[text];
      
      var selected = session.doc.getTextRange(range);
      if (!range.isMultiLine() && selected == lChar) {
         var line = session.doc.getLine(range.start.row);
         var rightChar = line.substring(range.start.column + 1, range.start.column + 2);
         if (rightChar == rChar) {
            range.end.column++;
            return range;
         }
      }
   };
   

   this.add("R", "insertion", function(state, action, editor, session, text) {

      if (text === "R" || text === "r") {

         var cursor = editor.getCursorPosition();
         var line = new String(session.doc.getLine(cursor.row));
         var match = line.match(/^(\s*)\/\*{3,}\s*/);
         if (match) {
            return {
               text: "R\n" + match[1] + "\n" + match[1] + "*/",
               selection: [1, match[1].length, 1, match[1].length]
            };
         }
      }

   });

   this.add("newline", "insertion", function(state, action, editor, session, text) {

      if (text === "\n") {

         // Get some needed variables.
         var cursor = editor.getCursorPosition();
         var row = cursor.row;
         var col = cursor.column;
         var tab = session.getTabString();
         var lines = session.doc.$lines;
         var line = lines[row];

         // If we're editing within a multi-line macro definition,
         // don't try to apply any custom behavior rules.
         if (this.codeModel.inMacro(lines, row - 1)) {
            return;
         }

         // If this line is an roxygen-style comment, continue that comment
         var match = /^(\s*\/\/'\s*)/.exec(line);
         if (match && col >= match[1].length)
         {
            return {
               text: "\n" + match[1]
            };
         }

         // If the user has started a multi-line comment block,
         // with text of the form:
         // 
         //     /**
         //
         // then fill in the rest of the comment with
         //
         //     /**
         //      * |
         //      */
         //
         if (/^\s*[/][*]+\s*$/.test(line))
         {
            // Check if this comment block has already been continued.
            var nextLine = lines[row + 1] || "";
            if (!/^\s*[*]/.test(nextLine))
            {
               var indent = this.$getIndent(line);
               var newIndent = indent + " * ";

               return {
                  text: "\n" + newIndent + "\n" + indent + " */",
                  selection: [1, newIndent.length, 1, newIndent.length]
               };
            }
         }

         // Comment indentation rules
         if (Utils.endsWith(state, "comment") ||
             Utils.endsWith(state, "doc-start"))
         {
            // Choose indentation for the current line based on the position
            // of the cursor -- but make sure we only apply this if the
            // cursor is on the same row as the line being indented
            if (cursor && cursor.row == row) {
               line = line.substring(0, cursor.column);
            }

            // If this is a comment start block, then insert appropriate indentation.
            var startMatch = /^(\s*)(\/\*)/.exec(line);
            if (startMatch)
            {
               return {
                  text: '\n' + startMatch[1] + " * "
               };
            }

            // We want to insert stars and spaces to match the indentation of the line.
            // Make sure we trim up to the cursor when necessary.
            var styleMatch = /^(\s*\*+\s*)/.exec(line);
            if (styleMatch) {
               return {
                  text: '\n' + styleMatch[1],
                  selection: [1, styleMatch[1].length, 1, styleMatch[1].length]
               };
            }
            
         }

         // Walk backwards over whitespace to find first non-whitespace char
         var i = col - 1;
         while (/\s/.test(line[i])) {
            --i;
         }
         var thisChar = line[i];
         var rightChar = line[col];

         // If we're creating a namespace, just use the line's indent itself
         var match = line.match(/\s*namespace\s*\w*\s*{/);
         if (match) {
            var indent = this.$getIndent(line);
            return {
               text: '\n' + indent,
               selection: [1, indent.length, 1, indent.length]
            };
         }

         // If we're handling the case where we want all function arguments
         // for a function call all on their own line, e.g.
         //
         // foo(
         //   |
         // )
         //
         // then indent appropriately, and put the closing paren on its
         // own line as well.
         if ((thisChar == "(" && rightChar == ")") ||
             (thisChar == "[" && rightChar == "]")) {

            var nextIndent = this.$getIndent(line);
            var indent = nextIndent + tab;
            
            return {
               text: "\n" + indent + "\n" + nextIndent,
               selection: [1, indent.length, 1, indent.length]
            };
         }

         // These insertion rules handle the case where we're inserting a newline
         // when within an auto-generated {} block; e.g. as class Foo {|};
         if (thisChar == '{' && rightChar == "}") {

            // If this line starts with an open brace, match that brace's indentation
            if (/^\s*{/.test(line)) {

               var nextIndent = this.$getIndent(line);
               var indent = nextIndent + session.getTabString();
               
               return {
                  text: "\n" + indent + "\n" + nextIndent,
                  selection: [1, indent.length, 1, indent.length]
               };
            }

            // Use heuristic indentation if possible
            var heuristicRow = codeModel.getRowForOpenBraceIndent(
               session, row
            );

            if (heuristicRow !== null && heuristicRow >= 0) {

               var nextIndent =
                      this.$getIndent(session.getDocument().getLine(heuristicRow));
               
               var indent = nextIndent + session.getTabString();
               
               return {
                  text: "\n" + indent + "\n" + nextIndent,
                  selection: [1, indent.length, 1, indent.length]
               };
               
            }

            // default behavior -- based on just the current row
            var nextIndent = this.$getIndent(line);
            var indent = nextIndent + tab;
            
            return {
               text: "\n" + indent + "\n" + nextIndent,
               selection: [1, indent.length, 1, indent.length]
            };
            
         }

      }
      
   });

   this.add("braces", "insertion", function (state, action, editor, session, text) {

      // Specialized insertion rules -- we infer whether a closing ';'
      // is appropriate, and we also provide comments for closing namespaces
      // (if desired)

      if (!this.insertMatching) return;
      
      if (text == '{') {

         // Ensure these rules are only run if there is no selection
         var selection = editor.getSelectionRange();
         var selected = session.doc.getTextRange(selection);
         if (selected === "") {

            // Get a token cursor, and place it at the cursor position.
            var cursor = this.codeModel.getTokenCursor();

            if (!cursor.moveToPosition(editor.getCursorPosition()))
               return autoPairInsertion("{", text, editor, session);

            do
            {
               // In case we're walking over a template class, e.g. for something like:
               //
               //    class Foo : public A<T>, public B<T>
               //
               // then we want to move over those matching arrows,
               // as their contents is non-informative for semi-colon insertion inference.
               if (cursor.bwdToMatchingArrow())
                  continue;

               var value = cursor.currentValue();
               if (!value || !value.length) break;

               // If we encounter a 'namespace' token, just insert a
               // single opening bracket. This is because we might be
               // enclosing some other namespaces following (and so the
               // automatic closing brace may be undesired)
               if (value === "namespace")
               {
                  return {
                     text: "{",
                     selection: [1, 1]
                  };
               }

               // If we encounter a 'class' or 'struct' token, this implies
               // we're defining a class -- add a semi-colon.
               //
               // We also do this for '=' operators, for C++11-style
               // braced initialization:
               //
               //    int foo = {1, 2, 3};
               //
               // TODO: Figure out if we can infer the same for braced initialization with
               // no equals; e.g.
               //
               //    MyClass object{1, 2, 3};
               //
               if (value === "class" ||
                   value === "struct" ||
                   value === "=")
               {
                  return {
                     text: "{};",
                     selection: [1, 1]
                  };
               }

               // Fill in the '{} while ()' bits for a do-while loop.
               if ($fillinDoWhile && value === "do")
               {
                  return {
                     text: "{} while ();",
                     selection: [1, 1]
                  };
               }

               // If, while walking backwards, we encounter certain tokens that
               // tell us we do not want semi-colon insertion, then stop there and return.
               if (value === ";" ||
                   value === "[" ||
                   value === "]" ||
                   value === "(" ||
                   value === ")" ||
                   value === "{" ||
                   value === "}" ||
                   value === "if" ||
                   value === "else" ||
                   value[0] === '#')
               {
                  return {
                     text: "{}",
                     selection: [1, 1]
                  };
               }
            } while (cursor.moveToPreviousToken());
         }

      }

      return autoPairInsertion("{", text, editor, session);

   });

   this.add("braces", "deletion", function (state, action, editor, session, range) {

      if (!this.insertMatching) return;
      
      var selected = session.doc.getTextRange(range);
      if (!range.isMultiLine() && selected == '{') {
         
         var line = session.doc.getLine(range.start.row);

         // Undo an auto-inserted do-while
         if (/^\s*do\s*\{\} while \(\);\s*$/.test(line)) {
            range.end.column = line.length;
            return range;
         }

         var rightChar = line.substring(range.end.column, range.end.column + 1);
         var rightRightChar =
                line.substring(range.end.column + 1, range.end.column + 2);
         if (rightChar == '}') {
            range.end.column++;
            if (rightRightChar == ';') {
               range.end.column++;
            }
            return range;
         }
      }
   });

   this.add("parens", "insertion", function (state, action, editor, session, text) {
      if (!this.insertMatching) return;
      return autoPairInsertion("(", text, editor, session);
   });

   this.add("parens", "deletion", function (state, action, editor, session, range) {
      if (!this.insertMatching) return;
      return autoPairDeletion("(", range, session);
   });
   
   this.add("brackets", "insertion", function (state, action, editor, session, text) {
      if (!this.insertMatching) return;
      return autoPairInsertion("[", text, editor, session);
   });

   this.add("brackets", "deletion", function (state, action, edditor, session, range) {
      if (!this.insertMatching) return;
      return autoPairDeletion("[", range, session);
   });

   this.add("arrows", "insertion", function (state, action, editor, session, text) {
      if (!this.insertMatching) return;
      var line = session.getLine(editor.getCursorPosition().row);
      if (!/^\s*#\s*include/.test(line)) return;
      return autoPairInsertion("<", text, editor, session);
   });

   this.add("arrows", "deletion", function (state, action, edditor, session, range) {
      if (!this.insertMatching) return;
      return autoPairDeletion("<", range, session);
   });

   this.add("string_dquotes", "insertion", function (state, action, editor, session, text) {
      if (!this.insertMatching) return;
      if (text == '"' || text == "'") {
         var quote = text;
         var selection = editor.getSelectionRange();
         var selected = session.doc.getTextRange(selection);
         if (selected !== "") {
            return {
               text: quote + selected + quote,
               selection: false
            };
         } else {
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            var leftChar = line.substring(cursor.column-1, cursor.column);

            // We're escaped.
            if (leftChar == '\\') {
               return null;
            }

            // Find what token we're inside.
            var tokens = session.getTokens(selection.start.row);
            var col = 0, token;
            var quotepos = -1; // Track whether we're inside an open quote.

            for (var x = 0; x < tokens.length; x++) {
               token = tokens[x];
               if (token.type == "string") {
                  quotepos = -1;
               } else if (quotepos < 0) {
                  quotepos = token.value.indexOf(quote);
               }
               if ((token.value.length + col) > selection.start.column) {
                  break;
               }
               col += tokens[x].value.length;
            }

            // Try and be smart about when we auto insert.
            if (!token || (quotepos < 0 && token.type !== "comment" && (token.type !== "string" || ((selection.start.column !== token.value.length+col-1) && token.value.lastIndexOf(quote) === token.value.length-1)))) {
               return {
                  text: quote + quote,
                  selection: [1,1]
               };
            } else if (token && token.type === "string") {
               // Ignore input and move right one if we're typing over the closing quote.
               var rightChar = line.substring(cursor.column, cursor.column + 1);
               if (rightChar == quote) {
                  return {
                     text: '',
                     selection: [1, 1]
                  };
               }
            }
         }
      }
   });

   this.add("string_dquotes", "deletion", function (state, action, editor, session, range) {
      if (!this.insertMatching) return;
      var selected = session.doc.getTextRange(range);
      if (!range.isMultiLine() && (selected == '"' || selected == "'")) {
         var line = session.doc.getLine(range.start.row);
         var rightChar = line.substring(range.start.column + 1, range.start.column + 2);
         if (rightChar === '"' || rightChar === "'") {
            range.end.column++;
            return range;
         }
      }
   });

   this.add("punctuation.operator", "insertion", function(state, action, editor, session, text) {
      
      if (!this.insertMatching) return;
      // Step over ';'
      // TODO: only insert semi-colon if text following cursor is just
      // semi-colon + whitespace
      if (text === ";") {
         var cursor = editor.selection.getCursor();
         var line = session.getLine(cursor.row);
         if (line[cursor.column] == ";") {
            return {
               text: '',
               selection: [1, 1]
            };
         }

      }

   });

   // Provide an experimental 'macro mode' -- this allows for automatic indentation
   // and alignment of inserted '/' characters, and also provides the regular
   // indentation rules for expressions constructed within a macro.
   this.add("macro", "insertion", function(state, action, editor, session, text) {

      var margin = editor.getPrintMarginColumn();
      var backslashAlignColumn = Math.min(62, margin);

      // Get some useful quantities
      var lines = session.getDocument().$lines;
      var cursor = editor.getCursorPosition();
      var row = cursor.row;
      var line = lines[row];
      var lineSub = line.substring(0, cursor.column);

      // Enter macro mode: we enter macro mode if the user inserts a
      // '\' after a '#define' line.
      if (/^\s*#\s*define[^\\]*$/.test(line) && text == "\\") {

         var len = backslashAlignColumn - lineSub.length + 1;

         if (len >= 0) {
            return {
               text: new Array(len + 1).join(" ") + "\\\n" + this.$getIndent(line) + session.getTabString(),
               selection: false
            };
         } else {
            return {
               text: "\\\n" + session.getTabString(),
               selection: false
            };
         }
      }

      // Special rules for 'macro mode'.
      if (/^\s*#\s*define/.test(line) || this.codeModel.inMacro(lines, row - 1)) {

         // Handle insertion of a '\'.
         //
         // If there is only whitespace following the cursor, then
         // we try to nudge out the inserted '\'. Note that we
         // have some protection in this outdenting because of the
         // automatic matching done by '', "" insertion (which is the
         // only other context where we would expect a user to insert '\')
         if (text == "\\" &&
             (/^\s*$/.test(line.substring(lineSub.length, line.length)))) {
                
            var len = backslashAlignColumn - lineSub.length + 1;

            if (len >= 0) {
               return {
                  text: new Array(len + 1).join(" ") + "\\",
                  selection: false
               };
            } else {
               return {
                  text: "\\",
                  selection: false
               };
            }
         }

         // Newlines function slightly differently in 'macro mode'.
         // When a newline is inserted, we automatically add in an aligned
         // '\' for continuation if the line isn't blank.
         // If we try to insert a newline on a line that already has a
         // closing '\', then we just move the cursor down.
         if (text == "\n") {

            // Leave the macro if the line is blank. This provides an
            // escape hatch for '\n'.
            if (/^\s*$/.test(line)) {
               return {
                  text: "\n",
                  selection: false
               };
            }

            // Don't enter macro mode if the line is just a #define (with
            // no trailing \)
            if (/^\s*#\s*define/.test(line) && !/\\\s*$/.test(line)) {
               return {
                  text: '\n',
                  selection: false
               };
            }

            // Check if we already have a closing backslash to the right of the cursor.
            // This rule makes enter effectively function as a 'move down' action, e.g.
            // pressing the down arrow on the keyboard.
            if (/\\\s*$/.test(line) && !/\\\s*$/.test(lineSub)) {
               return {
                  text: '',
                  selection: [1, cursor.column, 1, cursor.column]
               };
            }

            // Otherwise, on enter, push a '\' out to an alignment column, so that
            // macros get formatted in a 'pretty' way.
            var nextIndent = session.getMode().getNextLineIndent(
               state,
               line + "\\", // added so the indentation mode believes we're still in a macro
               session.getTabString(),
               row,
               false
            );
            
            var len = backslashAlignColumn - lineSub.length + 1;
            var backSlash = /\\\s*$/.test(lineSub) ?
                   "" :
                   "\\";

            if (len >= 0) {
               return {
                  text: new Array(len + 1).join(" ") + backSlash + "\n" + nextIndent,
                  selection: false
               };
            } else {
               return {
                  text: backSlash + "\n" + nextIndent,
                  selection: false
               };
            }
         }
      }
      
   });

};

oop.inherits(CStyleBehaviour, Behaviour);

exports.CStyleBehaviour = CStyleBehaviour;

exports.setFillinDoWhile = function(x) {
   $fillinDoWhile = x;
};

exports.getFillinDoWhile = function() {
   return $fillinDoWhile;
}

});
/*
 * cpp_code_model.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/cpp_code_model", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Range = require("ace/range").Range;

var TokenUtils = require("mode/token_utils").TokenUtils;
var TokenIterator = require("ace/token_iterator").TokenIterator;
var CppTokenCursor = require("mode/token_cursor").CppTokenCursor;

var CppScopeNode = require("mode/cpp_scope_tree").CppScopeNode;
var CppScopeManager = require("mode/cpp_scope_tree").CppScopeManager;

var getVerticallyAlignFunctionArgs = require("mode/r_code_model").getVerticallyAlignFunctionArgs;
var Utils = require("mode/utils");

var CppCodeModel = function(session, tokenizer,
                            statePattern, codeBeginPattern, codeEndPattern) {

   this.$session = session;
   this.$doc = session.getDocument();
   this.$tokenizer = tokenizer;

   this.$tokens = new Array(this.$doc.getLength());
   this.$statePattern = statePattern;
   this.$codeBeginPattern = codeBeginPattern;
   this.$codeEndPattern = codeEndPattern;

   this.$tokenUtils = new TokenUtils(
      this.$doc,
      this.$tokenizer,
      this.$tokens,
      this.$statePattern,
      this.$codeBeginPattern
   );

   this.$scopes = new CppScopeManager(CppScopeNode);

   var $firstChange = true;
   var onChangeMode = function(data, session)
   {
      if ($firstChange)
      {
         $firstChange = false;
         return;
      }

      this.$doc.off('change', onDocChange);
      this.$session.off('changeMode', onChangeMode);
   }.bind(this);

   var onDocChange = function(evt)
   {
      this.$onDocChange(evt);
   }.bind(this);

   this.$session.on('changeMode', onChangeMode);
   this.$doc.on('change', onDocChange);

   var that = this;
   
};

(function() {

   var contains = Utils.contains;

   this.getTokenCursor = function() {
      return new CppTokenCursor(this.$tokens, 0, 0, this);
   };

   this.$tokenizeUpToRow = function(row) {
      this.$tokenUtils.$tokenizeUpToRow(row);
   };

   var $walkBackForScope = function(cursor, that) {
      
      while (true) {
         
         var value = cursor.currentValue();
         var line = that.$doc.getLine(cursor.$row);

         // Bail on some specific tokens not found in
         // function type specifiers
         if (contains(["{", "}", ";"], value))
            break;

         // Bail on 'public:' etc.
         if (value === ":") {
            var prevValue = cursor.peekBwd().currentValue();
            if (contains(["public", "private", "protected"], prevValue))
               break;
         }

         // Bail on lines intended for the preprocessor
         if (/^\s*#/.test(line))
            break;

         if (!cursor.moveToPreviousToken())
            break;
         
      }
      
   };

   var debugCursor = function(message, cursor) {
      // console.log(message);
      // console.log(cursor);
      // console.log(cursor.currentToken());
   };

   var controlFlowKeywords = [
      "if", "else", "for", "do", "while", "struct", "class", "try",
      "catch", "switch"
   ];

   var $normalizeWhitespace = function(text) {
      text = text.trim();
      text = text.replace(/[\n\s]+/g, " ");
      return text;
   };

   var $truncate = function(text, width) {
      
      if (typeof width === "undefined")
         width = 80;
      
      if (text.length > width)
         text = text.substring(0, width) + "...";
      
      return text;
   };

   var $normalizeAndTruncate = function(text, width) {
      return $truncate($normalizeWhitespace(text), width);
   };

   this.$complements = {
      "<" : ">",
      ">" : "<",
      "{" : "}",
      "}" : "{",
      "[" : "]",
      "]" : "[",
      "(" : ")",
      ")" : "(",
      "'" : "'",
      '"' : '"'
   };

   // Align continuation slashses (for e.g. macros)
   this.alignContinuationSlashes = function(doc, range) {

      if (typeof range === "undefined") {
         range = {
            start: 0,
            end: doc.getLength()
         };
      }

      var lines = doc.$lines;
      if (!(lines instanceof Array)) {
         return false;
      }

      var n = lines.length;
      for (var i = range.start; i < range.end; i++) {
         if (reEndsWithBackslash.test(lines[i])) {
            var start = i;
            var j = i + 1;
            while (reEndsWithBackslash.test(lines[j]) && j <= range.end) {
               j++;
            }
            var end = j;

            var indices = lines.slice(start, end).map(function(x) {
               return x.lastIndexOf("\\");
            });

            var maxIndex = Math.max.apply(null, indices);

            for (var idx = 0; idx < end - start; idx++) {

               var pos = {
                  row: start + idx,
                  column: indices[idx]
               };

               var whitespace = new Array(maxIndex - indices[idx] + 1).join(" ");
               doc.insert(pos, whitespace);
            }
            
            i = j;
         }
      }

      return true;
      
   };

   this.allIndicesOf = function(string, character) {
      var result = [];
      for (var i = 0; i < string.length; i++) {
         if (string[i] == character) {
            result.push(i);
         }
      }
      return result;
   };

   // Heuristic for finding a matching '>'.
   //
   // We attempt to find matches for '<' and '>' where:
   //
   // 1. '>' occurs at the beginning of the line, and
   // 2. '<' occurs at the end of the line.
   //
   // Primarily intended for template contexts, e.g.
   //
   // template <                     <-- returns this row
   //     int RTYPE
   // >
   //
   // ^                              <-- want to align with that line
   this.getRowForMatchingEOLArrows = function(session, doc, row) {
      var maxLookback = 100;
      var balance = 0;
      var thisLine = "";
      for (var i = 1; i < maxLookback; i++) {
         thisLine = this.getLineSansComments(doc, row - i);

         // Small escape hatch -- break if we encounter a line ending with
         // a semi-colon since that should never happen in template contexts
         if (/;\s*$/.test(thisLine))
            break;
         
         if (/<\s*$/.test(thisLine) && !/<<\s*$/.test(thisLine)) {
            if (balance === 0) {
               return row - i;
            } else {
               balance--;
            }
         } else if (/^\s*>/.test(thisLine) && !/^\s*>>/.test(thisLine)) {
            balance++;
         }
      }
      
      return -1;
      
   };

   var reStartsWithDefine = /^\s*#\s*define/;
   var reEndsWithBackslash = /\\\s*$/;

   // NOTE: We need to be careful of comment block starts and ends. (/*, */)
   var reStartsWithContinuationToken = /^\s*[+\-/&^%$!<\>.?|=~]|^\s*\*[^/]|^\s*\/[^\*]/;
   var reEndsWithContinuationToken =       /[+\-*&^%$!<\>.?|=~]\s*$|\*[^/]\s*$|\/[^\*]\s*$/;

   var reContinuation = function(x) {
      return reStartsWithContinuationToken.test(x) ||
         reEndsWithContinuationToken.test(x);
   };

   var endsWithCommaOrOpenParen = function(x) {
      return /[,(]\s*$/.test(x);
   };

   var charCount = function(string, character) {
      return string.split(character).length - 1;
   };
   
   // Identify whether we're currently writing a macro -- either the current
   // line starts with a '#define' statement, or a chain of lines ending with
   // '\' leads back to a line starting with a '#define' statement.
   this.inMacro = function(lines, row) {

      var line = lines[row];

      if (row < 0) {
         return false;
      } else if (reEndsWithBackslash.test(line)) {
         if (reStartsWithDefine.test(line)) {
            return true;
         } else {
            return this.inMacro(lines, row - 1);
         }
      } else {
         return false;
      }
   };

   this.$buildScopeTreeUpToRow = function(maxrow) {

      function maybeEvaluateLiteralString(value) {
         // NOTE: We could evaluate escape sequences and whatnot here as well.
         //       Hard to imagine who would abuse Rnw by putting escape
         //       sequences in chunk labels, though.
         var match = /^(['"])(.*)\1$/.exec(value);
         if (!match)
            return value;
         else
            return match[2];
      }

      var maxRow = Math.min(maxrow + 30, this.$doc.getLength() - 1);
      this.$tokenUtils.$tokenizeUpToRow(maxRow);

      var tokenCursor = this.getTokenCursor();
      if (!tokenCursor.seekToNearestToken(this.$scopes.parsePos, maxRow))
         return;

      do
      {
         this.$scopes.parsePos = tokenCursor.currentPosition();
         this.$scopes.parsePos.column += tokenCursor.currentValue().length;

         //console.log("                                 Token: " + tokenCursor.currentValue() + " [" + tokenCursor.currentPosition().row + "x" + tokenCursor.currentPosition().column + "]");

         var tokenType = tokenCursor.currentToken().type;
         if (/\bsectionhead\b/.test(tokenType))
         {
            var sectionHeadMatch = /^\/\/'?[-=#\s]*(.*?)\s*[-=#]+\s*$/.exec(
                  tokenCursor.currentValue());

            if (!sectionHeadMatch)
               continue;

            var label = "" + sectionHeadMatch[1];
            if (label.length == 0)
               label = "(Untitled)";
            if (label.length > 50)
               label = label.substring(0, 50) + "...";

            this.$scopes.onSectionStart(label, tokenCursor.currentPosition());
         }
         
         else if (/\bcodebegin\b/.test(tokenType))
         {
            var chunkStartPos = tokenCursor.currentPosition();
            var chunkPos = {row: chunkStartPos.row + 1, column: 0};
            var chunkNum = this.$scopes.getTopLevelScopeCount()+1;
            var chunkLabel = "(R Code Chunk)";
            this.$scopes.onChunkStart(chunkLabel,
                                      chunkLabel,
                                      chunkStartPos,
                                      chunkPos);
         }
         else if (/\bcodeend\b/.test(tokenType))
         {
            var pos = tokenCursor.currentPosition();
            // Close any open functions
            while (this.$scopes.onScopeEnd(pos))
            {
            }

            pos.column += tokenCursor.currentValue().length;
            this.$scopes.onChunkEnd(pos);
         }
         else if (tokenCursor.currentValue() === "{")
         {
            // We need to determine if this open brace is associated with an
            // 1. namespace,
            // 2. class (struct),
            // 3. function,
            // 4. lambda,
            // 5. anonymous / other
            var localCursor = tokenCursor.cloneCursor();
            var startPos = localCursor.currentPosition();
            if (localCursor.isFirstSignificantTokenOnLine())
               startPos.column = 0;

            // namespace
            if (localCursor.peekBwd(2).currentValue() === "namespace") {

               // named namespace
               localCursor.moveToPreviousToken();
               var namespaceName = localCursor.currentValue();
               this.$scopes.onNamespaceScopeStart("namespace " + namespaceName,
                                                  localCursor.currentPosition(),
                                                  tokenCursor.currentPosition(),
                                                  namespaceName);
               
            }

            // anonymous namespace
            else if (localCursor.peekBwd().currentValue() === "namespace") {
               this.$scopes.onNamespaceScopeStart("anonymous namespace",
                                                  startPos,
                                                  tokenCursor.currentPosition(),
                                                  "<anonymous>");
            }

            // class (struct)
            else if (localCursor.peekBwd(2).currentValue() === "class" ||
                     localCursor.peekBwd(2).currentValue() === "struct" ||
                     localCursor.bwdOverClassInheritance()) {

               localCursor.moveToPreviousToken();
               
               // Clone the cursor and look back to get
               // the return type. Do this by walking
               // backwards until we hit a ';', '{',
               // '}'.
               var classCursor = localCursor.cloneCursor();
               $walkBackForScope(classCursor, this);

               var classStartPos = classCursor.peekFwd().currentPosition();
               var classText = this.$session.getTextRange(new Range(
                  classStartPos.row, classStartPos.column,
                  startPos.row, startPos.column
               ));
               
               classText = $normalizeWhitespace(classText);
               
               this.$scopes.onClassScopeStart(classText,
                                              localCursor.currentPosition(),
                                              tokenCursor.currentPosition(),
                                              classText);
            }

            // function and lambdas
            else if (
               localCursor.bwdOverConstNoexceptDecltype() &&
               (localCursor.bwdOverInitializationList() &&
                localCursor.moveBackwardOverMatchingParens()) ||
                  localCursor.moveBackwardOverMatchingParens()) {

               if (localCursor.peekBwd().currentType() === "identifier" ||
                   localCursor.peekBwd().currentValue() === "]" ||
                   /^operator/.test(localCursor.peekBwd().currentValue())) {
                  
                  var valueBeforeParen = localCursor.peekBwd().currentValue();
                  if (valueBeforeParen === "]") {

                     var lambdaStartPos = localCursor.currentPosition();
                     var lambdaText = this.$session.getTextRange(new Range(
                        lambdaStartPos.row, lambdaStartPos.column,
                        startPos.row, startPos.column - 1
                     ));

                     lambdaText = $normalizeWhitespace("lambda " + lambdaText);

                     // TODO: Extract lambda arguments.
                     this.$scopes.onLambdaScopeStart(lambdaText,
                                                     startPos,
                                                     tokenCursor.currentPosition());
                     
                  } else {

                     if (localCursor.moveToPreviousToken()) {

                        var fnType = "";
                        var fnName = localCursor.currentValue();
                        var fnArgs = "";

                        var enclosingScopes = this.$scopes.getActiveScopes(
                           localCursor.currentPosition());
                        
                        if (enclosingScopes != null) {
                           var parentScope = enclosingScopes[enclosingScopes.length - 1];
                           if (parentScope.isClass() &&
                               parentScope.label === "class " + fnName) {
                              if (localCursor.peekBwd().currentValue() === "~") {
                                 fnName = "~" + fnName;
                              }
                           } else {
                              // Clone the cursor and look back to get
                              // the return type. Do this by walking
                              // backwards until we hit a ';', '{',
                              // '}'.
                              var fnTypeCursor = localCursor.cloneCursor();
                              $walkBackForScope(fnTypeCursor, this);
                              
                              // Move back up one token
                              fnTypeCursor.moveToNextToken();

                              // Get the type from the text range
                              var fnTypeStartPos = fnTypeCursor.currentPosition();
                              var fnTypeEndPos = localCursor.currentPosition();
                              fnType = this.$session.getTextRange(new Range(
                                 fnTypeStartPos.row, fnTypeStartPos.column,
                                 fnTypeEndPos.row, fnTypeEndPos.column
                              ));
                           }
                           
                        }

                        // Get the position of the opening paren
                        var fnArgsCursor = localCursor.peekFwd();
                        var fnArgsStartPos = fnArgsCursor.currentPosition();

                        if (fnArgsCursor.fwdToMatchingToken()) {

                           // Move over 'const'
                           if (fnArgsCursor.peekFwd().currentValue() === "const")
                              fnArgsCursor.moveToNextToken();

                           // Move over 'noexcept'
                           if (fnArgsCursor.peekFwd().currentValue() === "noexcept")
                              fnArgsCursor.moveToNextToken();

                           // Move over parens
                           if (fnArgsCursor.currentValue() === "noexcept" &&
                               fnArgsCursor.peekFwd().currentValue() === "(") {
                              fnArgsCursor.moveToNextToken();
                              fnArgsCursor.fwdToMatchingToken();
                           }

                           var fnArgsEndPos = fnArgsCursor.peekFwd().currentPosition();
                           if (fnArgsEndPos)
                              fnArgs = this.$session.getTextRange(new Range(
                                 fnArgsStartPos.row, fnArgsStartPos.column,
                                 fnArgsEndPos.row, fnArgsEndPos.column
                              ));
                           
                        }
                        
                        var fullFnName;
                        if (fnType.length > 0)
                           fullFnName = $normalizeAndTruncate(
                              fnName.trim() + fnArgs.trim() + ": " + fnType.trim());
                        else
                           fullFnName = $normalizeAndTruncate(
                              fnName.trim() + fnArgs.trim());
                        
                        this.$scopes.onFunctionScopeStart(
                           fullFnName,
                           localCursor.currentPosition(),
                           tokenCursor.currentPosition(),
                           fnName.trim(),
                           fnArgs.split(",")
                        );
                     }
                  }
               }

               // It's possible that we were on something that 'looked' like a function call,
               // but wasn't actually (e.g. `while () { ... }`) -- handle these cases
               else {
                  this.$scopes.onScopeStart(startPos);
               }
            }
            // other (unknown)
            else {
               this.$scopes.onScopeStart(startPos);
            }
            
         }
         else if (tokenCursor.currentValue() === "}")
         {
            var pos = tokenCursor.currentPosition();
            if (tokenCursor.isLastSignificantTokenOnLine())
            {
               pos.column = this.$doc.getLine(pos.row).length + 1;
            }
            else
            {
               pos.column++;
            }
            this.$scopes.onScopeEnd(pos);
         }
      } while (tokenCursor.moveToNextToken(maxRow));
      
   };

   this.getCurrentScope = function(position, filter)
   {
      if (!filter)
         filter = function(scope) { return true; };

      if (!position)
         return "";
      this.$buildScopeTreeUpToRow(position.row);

      var scopePath = this.$scopes.getActiveScopes(position);
      if (scopePath)
      {
         for (var i = scopePath.length-1; i >= 0; i--) {
            if (filter(scopePath[i]))
               return scopePath[i];
         }
      }

      return null;
   };

   this.getScopeTree = function()
   {
      this.$buildScopeTreeUpToRow(this.$doc.getLength() - 1);
      return this.$scopes.getScopeList();
   };
   

   // Given a row with a '{', we look back for the row that provides
   // the start of the scope, for purposes of indentation. We look back
   // for:
   //
   // 1. A class token, or
   // 2. A constructor with an initializer list.
   //
   // Return 'null' if no row could be found, and the corresponding row
   // otherwise.
   this.getRowForOpenBraceIndent = function(session, row, useCursor) {

      var doc = session.getDocument();
      var lines = doc.$lines;
      if (lines.length <= 1) return -1;

      var line = lines[row];

      // Walk tokens backwards until we find something that provides
      // the appropriate indentation.
      if (this.$tokenUtils.$tokenizeUpToRow(row)) {

         try {

            // Remove any trailing '\' tokens, then reapply them. This way, indentation
            // will work even in 'macro mode'.
            var tokens = new Array(this.$tokens.length);

            for (var i = 0; i < this.$tokens.length; i++) {
               if (this.$tokens[i] != null &&
                   this.$tokens[i].length > 0) {
                  var rowTokens = this.$tokens[i];
                  if (rowTokens[rowTokens.length - 1].value === "\\") {
                     tokens[i] = this.$tokens[i].splice(rowTokens.length - 1, 1)[0];
                  }
               } 
            }

            var tokenCursor = this.getTokenCursor();
            if (useCursor) {
               var cursor = session.getSelection().getCursor();
               if (!tokenCursor.moveToPosition(cursor))
                  return 0;
            } else {
               tokenCursor.$row = row;

               var i = tokenCursor.$tokens[row].length - 1;
               for (var i = tokenCursor.$tokens[row].length - 1;
                    i >= 0;
                    i--)
               {
                  tokenCursor.$offset = i;
                  if (tokenCursor.currentValue() === "{") {
                     break;
                  }
               }
            }

            if (tokenCursor.peekBwd().currentValue() === "{" ||
                tokenCursor.currentValue() === ";") {
               return -1;
            }
            
            // Move backwards over matching parens. Note that we may need to walk up
            // e.g. a constructor's initialization list, so we need to check for
            //
            //     , a_(a)
            //
            // so we need to look two tokens backwards to see if it's a
            // comma or a colon.
            debugCursor("Before moving over initialization list", tokenCursor);
            tokenCursor.bwdOverInitializationList();

            debugCursor("Before moving over class inheritance", tokenCursor);
            tokenCursor.bwdOverClassInheritance();

            // If we didn't walk over anything previously, the cursor
            // will still be on the same '{'.  Walk backwards one token.
            if (tokenCursor.currentValue() === "{") {
               if (!tokenCursor.moveToPreviousToken()) {
                  return -1;
               }
            }

            // Bail if we encountered a '{'
            if (tokenCursor.currentValue() === "{") {
               return -1;
            }

            // Move backwards over any keywords.
            debugCursor("Before walking over keywords", tokenCursor);
            while (tokenCursor.currentType() === "keyword") {

               // Return on 'control flow' keywords.
               var value = tokenCursor.currentValue();
               
               if (contains(controlFlowKeywords, value))
                  return tokenCursor.$row;

               if (tokenCursor.$row === 0 && tokenCursor.$offset === 0)
                  return tokenCursor.$row;
               
               if (!tokenCursor.moveToPreviousToken())
                  return -1;
            }

            // Move backwards over matching parens.
            debugCursor("Before walking over matching parens", tokenCursor);

            // If we landed on a ':' token and the previous token is
            // e.g. public, then we went too far -- go back up one token.
            if (tokenCursor.currentValue() === ":") {

               var prevValue = tokenCursor.peekBwd().currentValue();
               if (contains(["public", "private", "protected"], prevValue))
               {
                  tokenCursor.moveToNextToken();
                  return tokenCursor.$row;
               }
            }

            if (tokenCursor.currentValue() === ":") {

               // We want to walk over specifiers preceeding the ':' which may
               // specify an initializer list. We need to walk e.g.
               //
               //    const foo) const noexcept(bar) :
               //
               // so we do this by jumping parens and keywords, stopping once
               // we hit an actual identifier.
               while (tokenCursor.moveToPreviousToken()) {

                  if (tokenCursor.bwdToMatchingToken()) {

                     if (tokenCursor.peekBwd().currentType() === "keyword") {
                        continue;
                     } else {
                        break;
                     }
                  }

                  if (tokenCursor.currentType() === "identifier")
                     break;
               }

            }

            if (tokenCursor.currentValue() === ")") {
               if (!tokenCursor.bwdToMatchingToken()) {
                  return -1;
               }
            }

            if (tokenCursor.currentValue() === "(") {
               if (!tokenCursor.moveToPreviousToken()) {
                  return -1;
               }
            }

            // Use this row for indentation.
            debugCursor("Ended at", tokenCursor);
            if (tokenCursor.currentValue() === "=") {
               if (tokenCursor.moveToPreviousToken()) {
                  return tokenCursor.$row;
               }
            }

            return tokenCursor.$row;
            
         } finally {

            for (var i = 0; i < tokens.length; i++) {
               if (typeof tokens[i] !== "undefined") {
                  this.$tokens[i].push(tokens[i]);
               }
            }
            
         }

      }

      // Give up
      return -1;
      
   };

   var getRegexIndices = function(regex, line) {

      var match = null;
      var indices = [];
      while ((match = regex.exec(line))) {
         indices.push(match.index);
      }
      return indices;
   };

   // Get a line, with comments (following '//') stripped. Also strip
   // a trailing '\' anticipating e.g. macros.
   this.getLineSansComments = function(doc, row, stripConstAndNoexcept) {

      if (row < 0) {
         return "";
      }
      
      var line = doc.getLine(row);

      // Strip quotes before stripping comments -- this is to avoid
      // problems with e.g.
      //
      //   int foo("// comment");
      //
      // Note that we preserve the quotes themselves, e.g. post strip
      // the line would appear as:
      //
      //   int foo("");
      //
      // as this allows other heuristics to still work fine.
      var indices = getRegexIndices(/(?!\\)\"/g, line);

      if (indices.length > 0 && indices.length % 2 === 0) {

         for (var i = 0; i < indices.length / 2; i = i + 2) {

            var start = indices[i];
            var end = indices[i + 1];

            line = line.substring(0, start + 1) +
                   line.substring(end, line.length);
         }
      }

      // Strip out a trailing line comment
      var index = line.indexOf("//");
      if (index != -1) {
         line = line.substring(0, index);
      }

      // Strip off a trailing '\' -- this is mainly done
      // for macro mode (so we get regular indentation rules)
      if (reEndsWithBackslash.test(line)) {
         line = line.substring(0, line.lastIndexOf("\\"));
      }

      if (stripConstAndNoexcept) {
         line = line
            .replace(/\bconst\b/, "")
            .replace(/\bnoexcept\b/, "");
      }

      return line;
      
   };

   this.findStartOfCommentBlock = function(lines, row, maxLookback) {
      var count = 0;
      var reCommentBlockStart = /^\s*\/+\*/;
      while (row >= 0 && count < maxLookback) {
         var line = lines[row];
         if (reCommentBlockStart.test(line)) {
            return row;
         }
         --row;
         ++count;
      }
      return -1;
   };

   this.getNextLineIndent = function(state, line, tab, row, dontSubset) {

      // Ask the R code model if we want to use vertical alignment
      var $verticallyAlignFunctionArgs = getVerticallyAlignFunctionArgs();

      var session = this.$session;
      var tabSize = session.getTabSize();
      var doc = session.getDocument();

      if (typeof row !== "number")
         row = session.getSelection().getCursor().row - 1;

      // If we went back too far, use the first row for indentation.
      if (row === -1) {
         var lineZero = doc.getLine(0);
         if (lineZero.length > 0) {
            return this.$getIndent(lineZero);
         } else {
            return "";
         }
      }

      // If this line is intended for the preprocessor, it should be aligned
      // at the start. Use the previous line for indentation.
      if (line.length === 0 || /^\s*#/.test(line))
         return this.getNextLineIndent(
            Utils.getPrimaryState(session, row - 1),
            doc.getLine(row - 1),
            tab,
            row - 1,
            dontSubset
         );

      var indent = this.$getIndent(line);
      var unindent = this.$getUnindent(line, tabSize);
      
      var lines = doc.$lines;

      var prevLine;
      if (row > 0) {
         prevLine = lines[row - 1];
      } else {
         prevLine = "";
      }

      // Indentation rules for comments
      if (Utils.endsWith(state, "comment") ||
          Utils.endsWith(state, "doc-start"))
      {

         // Choose indentation for the current line based on the position
         // of the cursor -- but make sure we only apply this if the
         // cursor is on the same row as the line being indented
         if (cursor && cursor.row == row) {
            line = line.substring(0, cursor.column);
         }

         // Bail if line is just whitespace. This is necessary for when the
         // cursor is to the left of a comment block.
         if (/^\s*$/.test(line)) {
            return this.$getIndent(lines[row]);
         }
         
         // NOTE: It is the responsibility of c_style_behaviour to insert
         // a '*' and leading spaces on newline insertion! We just look
         // for the opening block and use indentation based on that. Otherwise,
         // reindent will replicate the leading comment stars.
         var commentStartRow = this.findStartOfCommentBlock(lines, row, 200);
         if (commentStartRow !== null) {
            return this.$getIndent(lines[commentStartRow]) + " ";
         }
         
      }

      // Rules for the 'general' state
      if (Utils.endsWith(state, "start")) {

         var match = null;

         /**
          * We start by checking some special-cases for indentation --
          * ie, simple cases wherein we can resolve the correct form of
          * indentation from just the first, or previous, line.
          */

         // Indent after a #define with continuation; but don't indent
         // without continutation
         if (reStartsWithDefine.test(line)) {
            if (/\\\s*$/.test(line)) {
               return indent + tab;
            }
            return indent;
         }

         // Don't indent after a preprocessor line
         if (/^\s*#\s*\S/.test(line)) {
            return indent;
         }

         // Unindent after leaving a #define with continuation
         if (this.inMacro(lines, row - 1) &&
             !reEndsWithBackslash.test(line)) {
            return unindent;
         }

         // Decisions made should not depend on trailing comments in the line
         // So, we strip those out for the purposes of indentation.
         //
         // Note that we strip _after_ the define steps so that we can
         // effectively leverage the indentation rules within macro settings.
         line = this.getLineSansComments(doc, row);

         var cursor = session.getSelection().getCursor();

         // Choose indentation for the current line based on the position
         // of the cursor -- but make sure we only apply this if the
         // cursor is on the same row as the line being indented.
         //
         // Note that callers can set 'dontSubset' to avoid this behaviour;
         // this is desired for e.g. the 'reindent' function (which should
         // not take the position of the cursor into account)
         if (cursor && cursor.row == row && !dontSubset) {
            line = line.substring(0, cursor.column);
         }
         
         prevLine = this.getLineSansComments(doc, row - 1);

         // If this line is just whitespace, match that line's indent. This
         // ensures multiple enter keypresses can blast the cursor off into
         // space.
         if (typeof line !== "string") {
            return "";
         } else if (line.length === 0 ||
                    /^\s*$/.test(line))
         {
            return this.$getIndent(lines[row]);
         }

         // Unindent after leaving a block comment.
         //
         // /**
         //  *
         //  */
         // ^
         if (/\*\/\s*$/.test(line)) {

            // Find the start of the comment block
            var blockStartRow = this.findStartOfCommentBlock(
               lines,
               row,
               200
            );
            
            if (blockStartRow >= 0) {
               return this.$getIndent(lines[blockStartRow]);
            }
         }

         // Special-case indentation for aligned streaming.
         // This handles indentation for the case of e.g.
         //
         //   std::cout << foo
         //             << bar
         //             << baz;
         //   ^
         //
         if (/^\s*<</.test(line)) {
            var currentRow = row - 1;
            while (/^\s*<</.test(lines[currentRow])) {
               currentRow--;
            }
            return this.$getIndent(lines[currentRow]);
         }

         // Do something similar for '.' alignment, for chained
         // function calls:
         //
         //   foo.bar()
         //      .baz()
         //      .bam();
         //
         if (/^\s*\./.test(line)) {
            var currentRow = row - 1;
            while (/^\s*\./.test(lines[currentRow])) {
               currentRow--;
            }
            return this.$getIndent(lines[currentRow]);
         }

         // Don't indent for namespaces, switch statements.
         if (/\bnamespace\b.*\{\s*$/.test(line) ||
             /\bswitch\b.*\{\s*$/.test(line)) {
            return indent;
         }

         // Indent following an opening paren.
         // We prefer inserting two tabs here, reflecting the rules of
         // the Google C++ style guide:
         // http://google-styleguide.googlecode.com/svn/trunk/cppguide.html#Function_Declarations_and_Definitions
         //
         // We take a slightly different approach -- indentation for
         // function declarations gets two indents, while indentation
         // for function calls gets a single indent.
         if (line.match(/\(\s*$/)) {

            // Check for a function call.
            if (line.indexOf("=") !== -1 || /^\s*(return\s+)?[a-zA-Z0-9_.->:]+\(\s*$/.test(line))
               return indent + tab;
            return indent + tab + tab;
         }

         // If we have a class on its own, indent
         //
         //   class Foo
         //       ^
         //
         if (/^\s*(class|struct)\s*[\w]+\s*$/.test(line)) {
            return indent + tab;
         }

         // If we have a class with an open brace on the same line, indent
         //
         //   class Foo {
         //       ^
         //
         if (/^\s*(class|struct).*\{\s*$/.test(line)) {
            return indent + tab;
         }

         // If we have a line beginning a class definition ending with a colon, indent
         //
         //   class Foo :
         //       |
         //       ^
         //
         if (/^\s*(class|struct)\s+.+:\s*$/.test(line)) {
            return indent + tab;
         }

         // Match the indentation of the ':' in a statement e.g.
         //
         //   class Foo : public A
         //             ^
         //
         // Note the absence of a closing comma. This is for users
         // who would prefer to align commas with colons, when
         // doing multi-line inheritance.
         //
         // Need some special handling for e.g.
         //
         //   class Foo::Bar : public A
         //                  ^
         //
         var match = line.match(/(^\s*(?:class|struct)\s+.*\w[^:]):[^:]\s*.+/);
         if (match && !/,\s*/.test(line)) {
            return $verticallyAlignFunctionArgs ?
               new Array(match[1].length + 1).join(" ") :
               indent + tab;
         }

         // If we're looking at a class with the first inherited member
         // on the same line, e.g.
         //
         //   class Foo : public A,
         //               ^
         //
         match = line.match(/^(\s*(class|struct).*:\s*).*,\s*$/);
         if (match) {
            return $verticallyAlignFunctionArgs ?
               new Array(match[1].length + 1).join(" ") :
               indent + tab;
         }

         // If we're looking at something like inheritance for a class, e.g.
         //
         // class Foo
         // : public Bar,
         //   ^
         //
         // then indent according to the first word following the ':'.
         match = line.match(/^(\s*:\s*)(\w+).*,\s*$/);
         if (match) {
            return $verticallyAlignFunctionArgs ?
               new Array(match[1].length + 1).join(" ") :
               indent + tab;
         }

         // Similar to the above, but we have a leading colon with some
         // following text, and no closing comma; ie
         //
         //   class Foo
         //       : public A
         //       ^
         match = line.match(/^(\s*)[:,]\s*[\w\s]*$/);
         if (match) {
            return $verticallyAlignFunctionArgs ?
               new Array(match[1].length + 1).join(" ") :
               indent + tab;
         }

         // Indent for lines ending with a '<'.
         if (/<\s*$/.test(line)) {
            return indent + tab;
         }

         // If the line is entirely a string, then match that line's indent.
         if (/^\s*\".*\"\s*$/.test(line)) {
            return indent;
         }

         // Don't indent for templates e.g.
         //
         //     template < ... >
         if (/^\s*template\s*<.*>\s*$/.test(line) &&
             line.split(">").length == line.split("<").length) {
            return indent;
         }
         
         // Vertical alignment
         // We need to handle vertical alignment for two scenarios:
         // One, for multi-line function declarations, so that e.g.
         //
         //   void foo(int a, int b, 
         //            ^
         //
         // and two, for cases where we have multiple objects. Maybe
         // this can just be specialized for {.
         //
         //   static object foo {
         //        {foo, bar},
         //        ^
         //
         // Only do this if there are more opening parens than closing parens
         // on the line, so that indentation for e.g. initialization lists
         // work as expected:
         //
         //   Foo(Foo const& other)
         //       : a_(a),
         //         b_(b),
         //         ^
         var bracePos = /([\[\{\(<]).+,\s*$/.exec(line);
         if (bracePos) {

            // Loop through the openers until we find an unmatched brace on
            // the line
            var openers = ["(", "{", "[", "<"];
            for (var i = 0; i < openers.length; i++) {

               // Get the character alongside its complement
               var lChar = openers[i];
               var rChar = this.$complements[lChar];

               // Get the indices for matches of the character and its complement
               var lIndices = this.allIndicesOf(line, lChar);
               if (!lIndices.length) continue;
               
               var rIndices = this.allIndicesOf(line, rChar);

               // Get the index -- we use the first unmatched index
               var indexToUse = lIndices.length - rIndices.length - 1;
               if (indexToUse < 0) continue;

               var index = lIndices[indexToUse];

               if ($verticallyAlignFunctionArgs) {

                  // Find the first character following the open token --
                  // this is where we want to set the indentation
                  var firstCharAfter = line.substr(index + 1).match(/([^\s])/);
                  return new Array(index + firstCharAfter.index + 2).join(" ");
                  
               } else {
                  return indent + tab;
               }
               
            }
         }

         // If this line begins, or ends, with an operator token alongside the previous,
         // then just use this line's indentation. This ensures that we match the indentation
         // for continued lines, e.g.
         //
         //     a +
         //         b +
         //         ^
         //
         var i = row - 1;
         var prevLineNotWhitespace = prevLine;
         while (i >= 0 && /^\s*$|^\s*#/.test(prevLineNotWhitespace)) {
            prevLineNotWhitespace = this.getLineSansComments(doc, i);
            i--;
         }

         // e.g. __attribute__((noreturn))
         if (/^\s*__attribute__\(\(.*\)\)\s*$/.test(line)) {
            return this.$getIndent(line);
         }

         // modifiers on their own line, e.g.
         // static , static inline
         if (/^\s*[\w\s]+\s*$/.test(line) && ! /(class|struct|for|while|do|if|else|try)/.test(line) ) {
            return this.$getIndent(line);
         }

         if (reContinuation(line) && reContinuation(prevLineNotWhitespace))
            return this.$getIndent(line);

         // Try token walking
         if (this.$tokenUtils.$tokenizeUpToRow(row + 2)) {

            var tokens = new Array(this.$tokens.length);

            try {
               
               // Remove any trailing '\' tokens, then reapply them. This way, indentation
               // will work even in 'macro mode'.

               for (var i = 0; i < this.$tokens.length; i++) {
                  if (this.$tokens[i] != null &&
                      this.$tokens[i].length > 0) {
                     var rowTokens = this.$tokens[i];
                     if (rowTokens[rowTokens.length - 1].value === "\\") {
                        tokens[i] = this.$tokens[i].splice(rowTokens.length - 1, 1)[0];
                     }
                  } 
               }

               var tokenCursor = this.getTokenCursor();
               
               // If 'dontSubset' is false, then we want to plonk the token cursor
               // on the first token before the cursor. Otherwise, we place it at
               // the end of the current line
               if (!dontSubset)
               {
                  tokenCursor.moveToPosition(cursor);
               }
               else
               {
                  tokenCursor.$row = row;
                  tokenCursor.$offset = this.$tokens[row].length - 1;
               }

               // If there is no token on this current line (this can occur when this code
               // is accessed by e.g. the matching brace offset code) then move back
               // to the previous row
               while (tokenCursor.$offset < 0 && tokenCursor.$row > 0) {
                  tokenCursor.$row--;
                  tokenCursor.$offset = tokenCursor.$tokens[tokenCursor.$row].length - 1;
               }

               // If we're on a preprocessor line, keep moving back
               while (tokenCursor.$row > 0 &&
                      /^\s*#/.test(doc.getLine(tokenCursor.$row)))
               {
                  tokenCursor.$row--;
                  tokenCursor.$offset = tokenCursor.$tokens[tokenCursor.$row].length - 1;
               }

               // Set additional indent based on the first character
               var additionalIndent = "";

               // Keep track of where we started

               var startCursor = tokenCursor.cloneCursor();
               var startValue = startCursor.currentValue();
               var startType = startCursor.currentType();

               if (startType === "keyword" || contains(["{", ")", ">", ":"], startValue))
               {
                  additionalIndent = tab;
               }

               // Move over any initial semicolons
               while (tokenCursor.currentValue() === ";") {
                  if (!tokenCursor.moveToPreviousToken()) {
                     break;
                  }
               }

               var lastCursor = tokenCursor.cloneCursor();

               if ($verticallyAlignFunctionArgs)
               {
                  // If the token cursor is on an operator at the end of the
                  // line...
                  if (tokenCursor.isLastSignificantTokenOnLine() &&
                      (tokenCursor.currentType() === "keyword.operator" ||
                       tokenCursor.currentType() === "punctuation.operator"))
                  {
                     // ... and the line starts with a keyword...
                     var lineStartCursor = tokenCursor.cloneCursor();
                     lineStartCursor.$offset = 0;
                     
                     if (lineStartCursor.currentType() === "keyword")
                     {
                        // ... and there are more opening parens than closing on the line,
                        // then vertically align
                        var balance = line.split("(").length - line.split(")").length;
                        if (balance > 0) {
                           var parenMatch = line.match(/.*?\(\s*(\S)/);
                           if (parenMatch) {
                              return new Array(parenMatch[0].length).join(" ");
                           }
                        }
                     }
                  }
               }

               // If the token cursor is on a comma...
               if (tokenCursor.currentValue() === ",") {

                  // ... and the previous character is a ']', find its match for indentation.
                  if ($verticallyAlignFunctionArgs)
                  {
                     var peekOne = tokenCursor.peekBwd();
                     if (peekOne.currentValue() === "]") {
                        if (peekOne.bwdToMatchingToken()) {
                           return new Array(peekOne.currentPosition().column + 1).join(" ");
                        }
                     }
                     
                     // ... and there are more opening parens than closing on the line,
                     // then vertically align
                     var balance = line.split("(").length - line.split(")").length;
                     if (balance > 0) {
                        var parenMatch = line.match(/.*?\(\s*(\S)/);
                        if (parenMatch) {
                           return new Array(parenMatch[0].length).join(" ");
                        }
                     }
                  }

                  // ... and this is a continuation of multiple commas, e.g.
                  //
                  //     int x = foo,
                  //       y = bar,
                  //       z = baz;
                  //
                  // then return that indent
                  if (endsWithCommaOrOpenParen(line) &&
                      endsWithCommaOrOpenParen(prevLineNotWhitespace))
                     return this.$getIndent(line);

                  // ... and it's an entry in an enum, then indent
                  var clone = tokenCursor.cloneCursor();
                  if (clone.findOpeningBracket("{", false) &&
                      clone.bwdOverClassySpecifiers() &&
                      clone.currentValue() === "enum")
                  {
                     return this.$getIndent(lines[clone.$row]) + tab;
                  }

                  // ... and there is an '=' on the line, then indent
                  if (line.indexOf("=") !== -1)
                     return this.$getIndent(line) + tab;

                  // ... just return the indent of the current line
                  return this.$getIndent(line);
               }

               // If the token cursor is on an operator, ident if the previous
               // token is not a class modifier token.
               if (startType === "keyword.operator" &&
                   startValue !== ":") {
                  return this.$getIndent(lines[row]) + tab;
               }

               while (true)
               {

                  // The token cursor is undefined (we moved past the start of the
                  // document)
                  if (typeof tokenCursor.currentValue() === "undefined") {
                     if (typeof lastCursor.currentValue() !== "undefined") {
                        return this.$getIndent(lines[lastCursor.$row]) + additionalIndent;
                     }
                     return additionalIndent;
                  }

                  lastCursor = tokenCursor.cloneCursor();

                  // We hit a semi-colon -- use the first token after that semi-colon.
                  if (tokenCursor.currentValue() === ";") {
                     if (tokenCursor.moveToNextToken()) {
                        
                        var row = tokenCursor.$row;
                        // Move up over preproc lines
                        while (lines[row] != null && /^\s*#/.test(lines[row]))
                           ++row;
                        
                        return this.$getIndent(lines[row]) + additionalIndent;
                     }
                  }

                  // We hit a 'control flow' keyword ...
                  if (contains(
                        ["for", "while", "do", "try"],
                        tokenCursor.currentValue()))
                  {
                     // ... and the first token wasn't a semi-colon, then indent
                     if (startValue !== ";") {
                        return this.$getIndent(lines[tokenCursor.$row]) + additionalIndent;
                     }
                     
                  }

                  // We hit a colon ':'...
                  var peekOne = tokenCursor.peekBwd();
                  if (tokenCursor.currentValue() === ":") {

                     // ... preceeded by a class access modifier
                     if (contains(["public", "private", "protected"],
                                  peekOne.currentValue()))
                     {
                        // Indent once relative to the 'public:'s indentation.
                        return this.$getIndent(lines[peekOne.$row]) + tab;
                     }

                     // ... with a line starting with 'case'
                     var maybeCaseLine = lines[tokenCursor.$row];
                     if (/^\s*case/.test(maybeCaseLine)) {
                        return this.$getIndent(maybeCaseLine) + tab;
                     }

                     // ... opening an initialization list
                     if (peekOne.currentValue() === ")") {
                        var clone = peekOne.cloneCursor();
                        if (clone.bwdToMatchingToken()) {

                           var peek1 = clone.peekBwd(1);
                           var peek2 = clone.peekBwd(2);

                           if (
                              (peek1 !== null && peek1.currentType() === "identifier") &&
                                 (peek2 !== null && !/\boperator\b/.test(peek2.currentType()))
                           )
                           {
                              
                              return this.$getIndent(lines[clone.peekBwd().$row]) + additionalIndent;
                           }
                        }
                     }
                  }

                  // We hit a '[]()' lambda expression.
                  if (tokenCursor.currentValue() === "]" &&
                      tokenCursor.peekFwd().currentValue() === "(") {
                     var clone = tokenCursor.cloneCursor();
                     if (clone.bwdToMatchingToken()) {
                        return this.$getIndent(lines[clone.$row]) + additionalIndent;
                     }
                  }

                  // Vertical alignment for e.g. 'for ( ... ;'.
                  //
                  // NOTE: Any ')' token found with a match _will have been jumped over_,
                  // so we can assume that any opening token found does not have a match.
                  if (tokenCursor.currentValue() === "(" &&
                      peekOne.currentValue() === "for" &&
                      startValue === ";")
                  {
                     
                     // Find the matching paren for the '(' after the cursor
                     var lookaheadCursor = tokenCursor.peekFwd().cloneCursor();

                     return $verticallyAlignFunctionArgs ?
                        new Array(tokenCursor.peekFwd().currentPosition().column + 1).join(" ") :
                        this.$getIndent(lines[tokenCursor.peekFwd().$row]) + tab;
                     
                  }

                  // Alignment for e.g.
                  // int foo(int
                  //
                  //             ^
                  if ($verticallyAlignFunctionArgs) {
                     if (tokenCursor.currentValue() === "(" &&
                         !tokenCursor.isLastSignificantTokenOnLine())
                     {
                        tokenCursor.moveToNextToken();
                        return new Array(tokenCursor.currentPosition().column + 1 + tabSize).join(" ");
                        
                     }
                  }

                  // We hit an 'if' or an 'else'
                  if (tokenCursor.currentValue() === "if" ||
                      tokenCursor.currentValue() === "else") {
                     return this.$getIndent(lines[tokenCursor.$row]) + additionalIndent;
                  }

                  // We hit 'template <'
                  if (tokenCursor.currentValue() === "template" &&
                      tokenCursor.peekFwd().currentValue() === "<")
                  {
                     return this.$getIndent(lines[tokenCursor.$row]) + additionalIndent;
                  }

                  // We hit an '{'
                  if (tokenCursor.currentValue() === "{") {

                     var openBraceIndentRow = this.getRowForOpenBraceIndent(session, tokenCursor.$row);
                     if (openBraceIndentRow >= 0) {
                        
                        // Don't indent if the brace is on the same line as a 'namespace' token
                        var line = this.getLineSansComments(doc, openBraceIndentRow);
                        var indent = this.$getIndent(line);
                        
                        return /\bnamespace\b/.test(line) ?
                           indent :
                           indent + tab;
                        
                     } else {
                        return this.$getIndent(lines[tokenCursor.$row]) + tab;
                     }
                  }

                  // We're at the start of the document
                  if (tokenCursor.$row === 0 && tokenCursor.$offset === 0) {
                     return this.$getIndent(lines[0]) + additionalIndent;
                  }

                  // Walking:

                  // Step over parens. Walk over '>' only if we can
                  // find its match to be associated with a 'template'.
                  if (tokenCursor.currentValue() === ">")
                  {
                     var clone = tokenCursor.cloneCursor();
                     if (clone.bwdToMatchingArrow()) {
                        if (clone.peekBwd().currentValue() === "template") {
                           if (startValue === ">") additionalIndent = "";
                           return this.$getIndent(lines[clone.$row]) + additionalIndent;
                        }
                     }
                  }

                  tokenCursor.bwdToMatchingToken();

                  // If we cannot move to a previous token, bail
                  if (!tokenCursor.moveToPreviousToken())
                     break;

                  // If the token cursor is on a preproc line, skip it
                  while (tokenCursor.$row > 0 &&
                         /^\s*#/.test(lines[tokenCursor.$row]))
                  {
                     tokenCursor.$row--;
                     tokenCursor.$offset = this.$tokens[tokenCursor.$row].length - 1;
                  }
               }

            } finally {

               for (var i = 0; i < tokens.length; i++) {
                  if (typeof tokens[i] !== "undefined") {
                     this.$tokens[i].push(tokens[i]);
                  }
               }

            }
            
         }

      } // start state rules

      return indent;
   };

   this.$onDocChange = function(evt)
   {
      if (evt.action === "insert")
         this.$tokenUtils.$insertNewRows(evt.start.row, evt.end.row - evt.start.row);
      else
         this.$tokenUtils.$removeRows(evt.start.row, evt.end.row - evt.start.row);

      this.$tokenUtils.$invalidateRow(evt.start.row);
      this.$scopes.invalidateFrom(evt.start);
   };

   this.$getIndent = function(line)
   {
      var match = /^([ \t]*)/.exec(line);
      if (!match)
         return ""; // should never happen, but whatever
      else
         return match[1];
   };

   // Pad an indentation up to some size by adding leading spaces.
   // This preserves tabs in the indent. Returns indentation as-is
   // if it's already that size or greater.
   this.$padIndent = function(indent, tabSize, newIndentSize) {

      var tabsAsSpaces = new Array(tabSize + 1).join(" ");
      var indentLength = indent.replace("\t", tabsAsSpaces);

      if (indentLength >= newIndentSize) {
         return indent;
      } else {
         return indent +
            new Array(newIndentSize - indentLength + 1).join(" ");
      }
   };

   this.$getUnindent = function(line, tabSize) {

      // Get the current line indent
      var indent = this.$getIndent(line);
      if (indent === null || indent.length === 0) {
         return "";
      }

      // Try cutting off a tab.
      var tabIndex = indent.indexOf("\t");
      if (tabIndex != -1) {
         return indent.substring(0, tabIndex) +
            indent.substring(tabIndex + 1, indent.length);
      }

      // Otherwise, try to remove up to 'tabSize' number of spaces
      var numLeadingSpaces = 0;
      for (var i = 0; i < tabSize && i < indent.length; i++) {
         if (indent[i] === " ") {
            numLeadingSpaces++;
         }
      }
      
      return indent.substring(numLeadingSpaces, indent.length);
      
   };

   
}).call(CppCodeModel.prototype);

exports.CppCodeModel = CppCodeModel;

});

/*
 * cpp_scope_tree.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define('mode/cpp_scope_tree', ["require", "exports", "module"], function(require, exports, module) {

function debuglog(str) {
   // console.log(str);
}

var oop = require('ace/lib/oop');
var ScopeTree = require('mode/r_scope_tree');
var ScopeManager = ScopeTree.ScopeManager;
var ScopeNode = ScopeTree.ScopeNode;

var CppScopeNode = function(label, start, preamble, scopeType, scopeCategory, attributes) {
   this.label = label;
   this.start = start;
   this.preamble = preamble || start;
   this.end = null;
   this.scopeType = scopeType;
   this.scopeCategory = scopeCategory;
   this.attributes = attributes || {};
   this.parentScope = null;
   this.$children = [];
};
oop.mixin(CppScopeNode.prototype, ScopeNode.prototype);

CppScopeNode.CATEGORY_CLASS     = 1;
CppScopeNode.CATEGORY_NAMESPACE = 2;
CppScopeNode.CATEGORY_FUNCTION  = 3;
CppScopeNode.CATEGORY_LAMBDA    = 4;
CppScopeNode.CATEGORY_ANON      = 5;

(function() {

   this.isClass = function() {
      return this.scopeType == ScopeNode.TYPE_BRACE &&
         this.scopeCategory == CppScopeNode.CATEGORY_CLASS;
   };

   this.isNamespace = function() {
      return this.scopeType == ScopeNode.TYPE_BRACE &&
         this.scopeCategory == CppScopeNode.CATEGORY_NAMESPACE;
   };

   this.isFunction = function() {
      return this.scopeType == ScopeNode.TYPE_BRACE &&
         this.scopeCategory == CppScopeNode.CATEGORY_FUNCTION;
   };
   
   this.isLambda = function() {
      return this.scopeType == ScopeNode.TYPE_BRACE &&
         this.scopeCategory == CppScopeNode.CATEGORY_LAMBDA;
   };
   
   
}).call(CppScopeNode.prototype);

var CppScopeManager = function(ScopeNodeFactory) {

   this.$ScopeNodeFactory = ScopeNodeFactory;
   
   this.parsePos = {
      row: 0,
      column: 0
   };

   this.$root = new ScopeNodeFactory(
      "(Top Level)",
      this.parsePos,
      null,
      ScopeNode.TYPE_ROOT
   );
   
};
oop.mixin(CppScopeManager.prototype, ScopeManager.prototype);

(function() {

   this.onClassScopeStart = function(label, startPos, scopePos, name) {
      debuglog("adding class scope " + label);

      var node = new this.$ScopeNodeFactory(
         label,
         scopePos,
         startPos,
         ScopeNode.TYPE_BRACE,
         CppScopeNode.CATEGORY_CLASS,
         {name: name}
      );
      this.$root.addNode(node);

      this.printScopeTree();
   };

   this.onNamespaceScopeStart = function(label, startPos, scopePos, name) {
      debuglog("adding namespace scope " + label);

      var node = new this.$ScopeNodeFactory(
         label,
         scopePos,
         startPos,
         ScopeNode.TYPE_BRACE,
         CppScopeNode.CATEGORY_NAMESPACE,
         {name: name}
      );
      this.$root.addNode(node);

      this.printScopeTree();
   };

   this.onFunctionScopeStart = function(label, startPos, scopePos, name, args) {
      debuglog("adding function scope " + label);

      var node = new this.$ScopeNodeFactory(
         label,
         scopePos,
         startPos,
         ScopeNode.TYPE_BRACE,
         CppScopeNode.CATEGORY_FUNCTION,
         {name: name, args: args}
      );
      this.$root.addNode(node);

      this.printScopeTree();
   };

   this.onLambdaScopeStart = function(label, startPos, scopePos, args) {
      debuglog("adding lambda scope " + label);

      var node = new this.$ScopeNodeFactory(
         label,
         scopePos,
         startPos,
         ScopeNode.TYPE_BRACE,
         CppScopeNode.CATEGORY_LAMBDA,
         {args: args}
      );
      this.$root.addNode(node);

      this.printScopeTree();
   };

   this.onScopeStart = function(pos) {
      debuglog("adding anon brace-scope");
      this.$root.addNode(new this.$ScopeNodeFactory(null, pos, null,
                                          ScopeNode.TYPE_BRACE));
      this.printScopeTree();
   };

   this.onScopeEnd = function(pos) {
      var closed = this.$root.closeScope(pos, ScopeNode.TYPE_BRACE);
      if (closed)
         debuglog("brace-scope end: " + closed.label);
      else
         debuglog("extra brace-scope end");
      this.printScopeTree();
      return closed;
   };
   
}).call(CppScopeManager.prototype);

exports.CppScopeManager = CppScopeManager;
exports.CppScopeNode = CppScopeNode;

});
/*
 * dcf.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/dcf", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var DcfHighlightRules = require("mode/dcf_highlight_rules").DcfHighlightRules;

var Mode = function() {   
   this.$tokenizer = new Tokenizer(new DcfHighlightRules().getRules());
};
oop.inherits(Mode, TextMode);

(function() {
    this.getNextLineIndent = function(state, line, tab) {
        return this.$getIndent(line);
    };
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * dcf_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/dcf_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var DcfHighlightRules = function() {

    // regexp must not have capturing parentheses
    // regexps are ordered -> the first match is used

    this.$rules = {
        
        "start" : [ {
            token : ["keyword", "text"],
            regex : "^([^:]+)(:)"
        }, {
            token : "text",
            regex : ".+"
        } ]
    };
};
oop.inherits(DcfHighlightRules, TextHighlightRules);

exports.DcfHighlightRules = DcfHighlightRules;
});
/*
 * doc_comment_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
  * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/doc_comment_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var DocCommentHighlightRules = function() {

    this.$rules = {
        "start" : [ {
            token : "comment.doc.tag",
            regex : "[@\\\\][\\w\\d_]+" // TODO: fix email addresses
        }, {
            token : "comment.doc",
            merge : true,
            regex : "\\s+"
        }, {
            token : "comment.doc",
            merge : true,
            regex : "TODO"
        }, {
            token : "comment.doc",
            merge : true,
            regex : "[^@\\\\\\*]+"
        }, {
            token : "comment.doc",
            merge : true,
            regex : "."
        }]
    };
};

oop.inherits(DocCommentHighlightRules, TextHighlightRules);

DocCommentHighlightRules.getStartRule = function(start) {
    return {
        token : "comment.doc", // doc comment
        merge : true,
        regex : "\\/\\*[\\*\\!]",
        next  : start
    };
};

DocCommentHighlightRules.getEndRule = function (start) {
    return {
        token : "comment.doc", // closing comment
        merge : true,
        regex : "\\*\\/",
        next  : start
    };
};


exports.DocCommentHighlightRules = DocCommentHighlightRules;

});
/*
 * expand_selection.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("util/expand_selection", ["require", "exports", "module"], function(require, exports, module) {

var Editor = require("ace/editor").Editor;
var Range = require("ace/range").Range;
var VimProvider = require("ace/keyboard/vim");
var TokenIterator = require("ace/token_iterator").TokenIterator;
var Utils = require("mode/utils");

(function() {

   var self = this;

   var $debuggingEnabled = false;
   function debuglog(/*...*/)
   {
      if ($debuggingEnabled)
         for (var i = 0; i < arguments.length; i++)
            console.log(arguments[i]);
   }

   function isCommentedRow(editor, row)
   {
      var tokens = editor.session.getTokens(row);
      for (var i = 0; i < tokens.length; i++)
      {
          var token = tokens[i];
          if (/^\s*$/.test(token.value))
             continue;

          return /\bcomment\b/.test(token.type);
      }

      return false;

   }

   function isExpansionOf(candidate, range)
   {
      var isLeftExpansion =
             candidate.start.row < range.start.row ||
             (candidate.start.row === range.start.row && candidate.start.column < range.start.column);

      var isLeftSame =
             candidate.start.row === range.start.row &&
             candidate.start.column === range.start.column;

      var isRightExpansion =
             candidate.end.row > range.end.row ||
             (candidate.end.row === range.end.row && candidate.end.column > range.end.column);

      var isRightSame =
             candidate.end.row === range.end.row &&
             candidate.end.column === range.end.column;

      if (isLeftExpansion)
         return isRightExpansion || isRightSame;
      else if (isRightExpansion)
         return isLeftExpansion || isLeftSame;
      else
         return false;
   }

   var reIdentifier = /['"\w.]/;

   function moveToStartOfStatement(iterator, delimiters)
   {
      var lookahead = iterator.getCurrentToken();
      var row = iterator.getCurrentTokenRow();
      while (iterator.moveToPreviousSignificantToken())
      {
         var token = iterator.getCurrentToken();
         if (row !== iterator.getCurrentTokenRow() &&
             token.type.indexOf("keyword.operator") !== 0)
         {
            if (!iterator.moveToNextSignificantToken())
               return false;

            return true;
         }

         if (reIdentifier.test(lookahead.value))
         {
            if (reIdentifier.test(token.value) ||
                Utils.isOpeningBracket(token.value) ||
                Utils.contains(delimiters, token.value))
            {
               if (!iterator.moveToNextSignificantToken())
                  return false;

               return true;
            }
         }

         iterator.bwdToMatchingToken();
         lookahead = iterator.getCurrentToken();
         row = iterator.getCurrentTokenRow();
      }

      return true;
   }

   function moveToEndOfStatement(iterator, delimiters)
   {
      var lookbehind = iterator.getCurrentToken();
      var row = iterator.getCurrentTokenRow();
      while (iterator.moveToNextSignificantToken())
      {
         var token = iterator.getCurrentToken();
         if (row !== iterator.getCurrentTokenRow() &&
             lookbehind.type.indexOf("keyword.operator") !== 0)
         {
            if (!iterator.moveToPreviousSignificantToken())
               return false;

            return true;
         }

         if (reIdentifier.test(lookbehind.value) ||
             Utils.isClosingBracket(lookbehind.value))
         {
            if (reIdentifier.test(token.value) ||
                Utils.isClosingBracket(token.value) ||
                Utils.contains(delimiters, token.value))
            {
               if (!iterator.moveToPreviousSignificantToken())
                  return false;

               return true;
            }
         }

         iterator.fwdToMatchingToken();
         lookbehind = iterator.getCurrentToken();
         row = iterator.getCurrentTokenRow();
      }

      return true;
   }


   var $handlersAttached = false;
   function ensureOnChangeHandlerAttached()
   {
      if (!$handlersAttached)
      {
         self.on("change", self.$onClearSelectionHistory);
         $handlersAttached = true;
      }
   }

   function ensureOnChangeHandlerDetached()
   {
      if ($handlersAttached)
      {
         self.off("change", self.$onClearSelectionHistory);
         $handlersAttached = false;
      }
   }

   this.$onClearSelectionHistory = function()
   {
      return self.$clearSelectionHistory();
   };

   this.$clearSelectionHistory = function()
   {
      this.$selectionRangeHistory = null;
      this.off("change", this.$clearSelectionHistory);
   };

   this.$acceptSelection = function(selection, newRange, oldRange)
   {
      debuglog("Accepting selection: ", oldRange, newRange);
      if (this.$selectionRangeHistory == null)
         this.$selectionRangeHistory = [];

      selection.setSelectionRange(newRange);

      var normalizedRange = selection.getRange();
      if (!normalizedRange.isEqual(oldRange))
         this.$selectionRangeHistory.push(oldRange);

      if (!(this.isRowFullyVisible(newRange.start.row) &&
            this.isRowFullyVisible(newRange.end.row)))
      {
         this.centerSelection(selection);
      }

      return newRange;
   };

   var $expansionFunctions = [];
   function addExpansionRule(name, immediate, method)
   {
      $expansionFunctions.push({
         name: name,
         immediate: immediate,
         execute: method
      });
   }

   addExpansionRule("string", true, function(editor, session, selection, range) {
      var token = session.getTokenAt(range.start.row, range.start.column + 1);
      if (token && /\bstring\b/.test(token.type)) {
         return new Range(
            range.start.row,
            token.column + 1,
            range.start.row,
            token.column + token.value.length - 1
         );
      }

      return null;
   });

   addExpansionRule("token", true, function(editor, session, selection, range) {

      var token = session.getTokenAt(range.start.row, range.start.column + 1);
      if (token && /[\d\w]/.test(token.value)) {
         return new Range(
            range.start.row, token.column,
            range.start.row, token.column + token.value.length
         );
      }

      return null;

   });

   addExpansionRule("comment", true, function(editor, session, selection, range) {

      // First, check that the whole selection is commented.
      var startRow = range.start.row;
      var endRow = range.end.row;

      for (var row = startRow; row <= endRow; row++)
      {
         if (!isCommentedRow(editor, row))
            return null;
      }

      // Now, expand the selection to include any other comments attached.
      while (isCommentedRow(editor, startRow))
         startRow--;

      while (isCommentedRow(editor, endRow))
         endRow++;

      var endColumn = editor.getSession().getLine(endRow - 1).length;
      return new Range(startRow + 1, 0, endRow - 1, endColumn);

   });

   addExpansionRule("includeBoundaries", true, function(editor, session, selection, range) {

      var lhsItr = new TokenIterator(session);
      var lhsToken = lhsItr.moveToPosition(range.start);
      if (range.start.column === 0)
         lhsToken = lhsItr.moveToPreviousToken();

      var rhsItr = new TokenIterator(session);
      var rhsToken = rhsItr.moveToPosition(range.end, true);

      if (lhsToken && rhsToken)
      {
         // Check for complementing types
         var isMatching =
                lhsToken.type === "support.function.codebegin" &&
                rhsToken.type === "support.function.codeend";

         if (!isMatching)
         {
            // Check for complementing brace types
            isMatching =
               Utils.isOpeningBracket(lhsToken.value) &&
               Utils.getComplement(lhsToken.value) === rhsToken.value;
         }

         if (isMatching)
         {
            debuglog("Expanding to match selection");
            var lhsPos = lhsItr.getCurrentTokenPosition();
            var rhsPos = rhsItr.getCurrentTokenPosition();
            rhsPos.column += rhsToken.value.length;
            return Range.fromPoints(lhsPos, rhsPos);
         }
      }

      return null;

   });

   addExpansionRule("matching", false, function(editor, session, selection, range) {

      // Look for matching bracket pairs. Note that this block does not
      // immediately return if a candidate range is found -- if the expansion
      // spans new rows, we may instead choose to just expand the current
      // selection to fill both the start and end rows.
      var iterator = new TokenIterator(session);
      var token = iterator.moveToPosition(range.start);
      if (token == null)
         return null;

      do
      {
         if (token == null)
            break;

         if (iterator.bwdToMatchingToken())
            continue;

         if (Utils.isOpeningBracket(token.value) ||
             token.type === "support.function.codebegin")
         {
            var startPos = iterator.getCurrentTokenPosition();
            if (token.type === "support.function.codebegin") {
               startPos.row++;
               startPos.column = 0;
            } else {
               startPos.column += token.value.length;
            }

            var clone = iterator.clone();
            if (clone.fwdToMatchingToken()) {
               var endPos = clone.getCurrentTokenPosition();
               if (token.type === "support.function.codebegin") {
                   endPos.row--;
                   endPos.column = session.getLine(endPos.row).length;
               }
               return Range.fromPoints(startPos, endPos);
            }

         }
      }
      while ((token = iterator.stepBackward()))

      return null;

   });

   addExpansionRule("statement", false, function(editor, session, selection, range) {

      var bwdIt = new TokenIterator(session);
      if (!bwdIt.moveToPosition(range.start, true))
         return null;

      var fwdIt = new TokenIterator(session);
      if (!fwdIt.moveToPosition(range.end))
         return null;

      if (!moveToStartOfStatement(bwdIt, [";", ",", "=", "<-", "<<-"]))
         return null;

      if (!moveToEndOfStatement(fwdIt, [";", ","]))
         return null;

      var bwdPos = bwdIt.getCurrentTokenPosition();
      var fwdPos = fwdIt.getCurrentTokenPosition();

      if (bwdPos.row === range.start.row &&
          bwdPos.column === range.start.column &&
          fwdPos.row === range.end.row &&
          fwdPos.column <= range.end.column)
      {
         if (!moveToStartOfStatement(bwdIt, [";", ","]))
            return null;
      }

      var start = bwdIt.getCurrentTokenPosition();
      var end   = fwdIt.getCurrentTokenPosition();
      end.column += fwdIt.getCurrentTokenValue().length;

      return Range.fromPoints(start, end);
   });

   addExpansionRule("scope", false, function(editor, session, selection, range) {

      var mode = session.getMode();
      if (mode.codeModel == null || mode.codeModel.getCurrentScope == null)
         return null;

      var candidates = [];

      var scope = mode.codeModel.getCurrentScope(range.start);
      while (scope != null)
      {
         var startPos = scope.preamble;
         var endPos = scope.end;

         if (endPos == null && scope.parentScope)
         {
            var siblings = scope.parentScope.$children;
            for (var i = siblings.length - 2; i >= 0; i--)
            {
               if (siblings[i].equals(scope))
               {
                  endPos = siblings[i + 1].preamble;
                  break;
               }
            }
         }

         if (endPos == null)
            endPos = {row: session.getLength(), column: 0};

         candidates.push(Range.fromPoints(startPos, endPos));
         scope = scope.parentScope;
      }

      if (candidates.length === 0)
         return null;

      return candidates;

   });

   addExpansionRule("everything", false, function(editor, session, selection, range) {

      var n = session.getLength();
      if (n === 0)
         return new Range(0, 0, 0, 0);

      var lastLine = session.getLine(n - 1);
      return new Range(0, 0, n - 1, lastLine.length);

   });

   this.$expandSelection = function()
   {
      debuglog("Begin new expand selection session");
      debuglog("----------------------------------");

      ensureOnChangeHandlerAttached();

      // Extract some useful objects / variables.
      var session = this.getSession();
      var selection = this.getSelection();
      var initialRange = selection.getRange();

      // Loop through the registered expansion functions, and apply them.
      // Store the candidate ranges for later selection.
      var allCandidates = [];
      for (var i = 0; i < $expansionFunctions.length; i++)
      {
         var rule = $expansionFunctions[i];

         // Get the candidate range to use for expansion.
         var candidates = rule.execute(this, session, selection, initialRange);
         if (!Utils.isArray(candidates))
            candidates = [candidates];

         for (var j = 0; j < candidates.length; j++)
         {
            var candidate = candidates[j];

            // Check to see if we should apply it immediately.
            if (candidate && rule.immediate && isExpansionOf(candidate, initialRange))
            {
               debuglog("Accepting immediate expansion: '" + rule.name + "'");
               return this.$acceptSelection(selection, candidate, initialRange);
            }

            // Otherwise, add it to the list of candidates for later filtering.
            if (candidate && isExpansionOf(candidate, initialRange))
            {
               allCandidates.push({
                  name: rule.name,
                  range: candidate
               });
            }
         }

      }

      // Sort candidates by size of range. We want to choose the smallest range
      // that is still an expansion of the initial range.
      allCandidates.sort(function(lhs, rhs) {

         var lhs = lhs.range;
         var rhs = rhs.range;

         var lhsRowSpan = lhs.end.row - lhs.start.row;
         var rhsRowSpan = rhs.end.row - rhs.start.row;

         if (lhsRowSpan !== rhsRowSpan)
            return lhsRowSpan > rhsRowSpan;

         var lhsColSpan = lhs.end.column - lhs.start.column;
         var rhsColSpan = rhs.end.column - rhs.start.column;

         return lhsColSpan > rhsColSpan;

      });

      // Choose the smallest expansion.
      var bestFit = allCandidates[0].range;
      debuglog("Selected candidate '" + allCandidates[0].name + "'", bestFit);
      return this.$acceptSelection(selection, bestFit, initialRange);

   };

   this.$shrinkSelection = function()
   {
      var history = this.$selectionRangeHistory;
      if (history && history.length) {
          var range = history.pop();
          this.getSelection().setSelectionRange(range);
          if (!(this.isRowFullyVisible(range.start.row) &&
                this.isRowFullyVisible(range.end.row)))
          {
             this.centerSelection(this.getSelection());
          }
          return range;
      }

      // No more history means we don't need to track
      // document changed any more.
      ensureOnChangeHandlerDetached();
      return this.getSelectionRange();

   };

}).call(Editor.prototype);

});
/*
 * markdown.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/markdown", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var JavaScriptMode = require("ace/mode/javascript").Mode;
var XmlMode = require("ace/mode/xml").Mode;
var HtmlMode = require("ace/mode/html").Mode;
var MarkdownHighlightRules = require("mode/markdown_highlight_rules").MarkdownHighlightRules;
var MarkdownFoldMode = require("mode/markdown_folding").FoldMode;

var Mode = function() {
   this.HighlightRules = MarkdownHighlightRules;

   this.createModeDelegates({
      "js-": JavaScriptMode,
      "xml-": XmlMode,
      "html-": HtmlMode
   });

   this.foldingRules = new MarkdownFoldMode();
};
oop.inherits(Mode, TextMode);

(function() {
   this.type = "text";
   this.blockComment = {start: "<!--", end: "-->"};

   this.getNextLineIndent = function(state, line, tab) {
      return this.$getIndent(line);
   };


   this.$id = "mode/markdown";
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * markdown_folding.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/markdown_folding", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var BaseFoldMode = require("ace/mode/folding/fold_mode").FoldMode;
var Range = require("ace/range").Range;

var FoldMode = exports.FoldMode = function() {};
var Utils = require("mode/utils");

oop.inherits(FoldMode, BaseFoldMode);

(function() {

    this.foldingStartMarker = /^(?:[=-]+\s*$|#{1,6} |`{3})/;

    this.getFoldWidget = function(session, foldStyle, row) {

        var FOLD_NONE  = "";
        var FOLD_START = "start";
        var FOLD_END   = foldStyle === "markbeginend" ? "end" : "";

        var line = session.getLine(row);
        if (!this.foldingStartMarker.test(line))
            return FOLD_NONE;

        if (line[0] == "`")
        {
            return Utils.getPrimaryState(session, row) === "start" ?
                FOLD_END :
                FOLD_START;
        }

        return FOLD_NONE;
    };

    this.getFoldWidgetRange = function(session, foldStyle, row) {
        var line = session.getLine(row);
        var startColumn = line.length;
        var maxRow = session.getLength();
        var startRow = row;
        var endRow = row;
        if (!line.match(this.foldingStartMarker))
            return;

        if (line[0] == "`") {
            if (Utils.getPrimaryState(session, row) !== "start") {
                while (++row < maxRow) {
                    line = session.getLine(row);
                    if (line[0] == "`" & line.substring(0, 3) == "```")
                        break;
                }
                return new Range(startRow, startColumn, row, 0);
            } else {
                while (row -- > 0) {
                    line = session.getLine(row);
                    if (line[0] == "`" & line.substring(0, 3) == "```")
                        break;
                }
                return new Range(row, line.length, startRow, 0);
            }
        }

        var token;
        function isHeading(row) {
            token = session.getTokens(row)[0];
            return token && token.type.lastIndexOf(heading, 0) === 0;
        }

        var heading = "markup.heading";
        function getLevel() {
            var ch = token.value[0];
            if (ch == "=") return 6;
            if (ch == "-") return 5;
            return 7 - token.value.search(/[^#]/);
        }

        if (isHeading(row)) {
            var startHeadingLevel = getLevel();
            while (++row < maxRow) {
                if (!isHeading(row))
                    continue;
                var level = getLevel();
                if (level >= startHeadingLevel)
                    break;
            }

            endRow = row - (!token || ["=", "-"].indexOf(token.value[0]) == -1 ? 1 : 2);

            if (endRow > startRow) {
                while (endRow > startRow && /^\s*$/.test(session.getLine(endRow)))
                    endRow--;
            }

            if (endRow > startRow) {
                var endColumn = session.getLine(endRow).length;
                return new Range(startRow, startColumn, endRow, endColumn);
            }
        }
    };

}).call(FoldMode.prototype);

});
/*
 * markdown_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/markdown_highlight_rules", ["require", "exports", "module"], function (require, exports, module) {

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var JavaScriptHighlightRules = require("ace/mode/javascript_highlight_rules").JavaScriptHighlightRules;
var XmlHighlightRules = require("ace/mode/xml_highlight_rules").XmlHighlightRules;
var HtmlHighlightRules = require("ace/mode/html_highlight_rules").HtmlHighlightRules;
var CssHighlightRules = require("ace/mode/css_highlight_rules").CssHighlightRules;
var ScssHighlightRules = require("ace/mode/scss_highlight_rules").ScssHighlightRules;
var SassHighlightRules = require("ace/mode/sass_highlight_rules").SassHighlightRules;
var LessHighlightRules = require("ace/mode/less_highlight_rules").LessHighlightRules;
var PerlHighlightRules = require("ace/mode/perl_highlight_rules").PerlHighlightRules;
var PythonHighlightRules = require("mode/python_highlight_rules").PythonHighlightRules;
var RubyHighlightRules = require("ace/mode/ruby_highlight_rules").RubyHighlightRules;
var ScalaHighlightRules = require("ace/mode/scala_highlight_rules").ScalaHighlightRules;
var ShHighlightRules = require("mode/sh_highlight_rules").ShHighlightRules;
var StanHighlightRules = require("mode/stan_highlight_rules").StanHighlightRules;
var SqlHighlightRules = require("mode/sql_highlight_rules").SqlHighlightRules;
var MermaidHighlightRules = require("mode/mermaid_highlight_rules").MermaidHighlightRules;
var DotHighlightRules = require("ace/mode/dot_highlight_rules").DotHighlightRules;


var escaped = function (ch) {
   return "(?:[^" + lang.escapeRegExp(ch) + "\\\\]|\\\\.)*";
};

var $rainbowFencedDivs = true;
var $numFencedDivsColors = 7;

exports.setRainbowFencedDivs = function (value) {
   $rainbowFencedDivs = value;
};
exports.getRainbowFencedDivs = function () {
   return $rainbowFencedDivs;
};
exports.setNumFencedDivsColors = function (value) {
   $numFencedDivsColors = value;
};

var MarkdownHighlightRules = function () {

   var slideFields = lang.arrayToMap(
      ("title|author|date|rtl|depends|autosize|width|height|transition|transition-speed|font-family|css|class|navigation|incremental|left|right|id|audio|video|type|at|help-doc|help-topic|source|console|console-input|execute|pause")
         .split("|")
   );

   // regexp must not have capturing parentheses
   // regexps are ordered -> the first match is used

   // handle highlighting for *abc*, _abc_ separately, as pandoc's
   // parser is a bit more strict about where '_' can appear
   var strongUnderscore = {
      token: ["text", "constant.numeric.text", "constant.numeric.text", "constant.numeric.text"],
      regex: "(^|\\s+)(_{2,3})(?![\\s_])(.*?)(?=_)(\\2)\\b"
   };

   var emphasisUnderscore = {
      token: ["text", "constant.language.boolean.text"],
      regex: "(^|\\s+)(_(?=[^\\s_]).*?_)\\b"
   };

   var strongStars = {
      token: ["constant.numeric.text", "constant.numeric.text", "constant.numeric.text"],
      regex: "([*]{2,3})(?![\\s*])(.*?)(?=[*])(\\1)"
   };

   var emphasisStars = {
      token: ["constant.language.boolean.text"],
      regex: "([*](?=[^\\s*]).*?[*])"
   };

   var inlineNote = {
      token: "text",
      regex: "\\^\\[" + escaped("]") + "\\]"
   };

   var reference = {
      token: ["text", "constant", "text", "url", "string", "text"],
      regex: "^([ ]{0,3}\\[)([^\\]]+)(\\]:\\s*)([^ ]+)(\\s*(?:[\"][^\"]+[\"])?(\\s*))$"
   };

   var linkByReference = {
      token: ["text", "keyword", "text", "constant", "text"],
      regex: "(\\s*\\[)(" + escaped("]") + ")(\\]\\[)(" + escaped("]") + ")(\\])"
   };

   var linkByUrl = {
      token: ["text", "keyword", "text", "markup.href", "string", "text", "paren.keyword.operator", "nospell", "paren.keyword.operator"],
      regex: "(\\s*\\[)(" +                            // [
         escaped("]") +                                // link text
         ")(\\]\\()" +                                 // ](
         '((?:[^\\)\\s\\\\]|\\\\.|\\s(?=[^"]))*)' +    // href
         '(\\s*"' + escaped('"') + '"\\s*)?' +        // "title"
         "(\\))" +                                     // )
         "(?:(\\s*{)((?:[^\\}]+))(\\s*}))?"            // { block text }
   };

   var urlLink = {
      token: ["text", "keyword", "text"],
      regex: "(<)((?:https?|ftp|dict):[^'\">\\s]+|(?:mailto:)?[-.\\w]+\\@[-a-z0-9]+(?:\\.[-a-z0-9]+)*\\.[a-z]+)(>)"
   };

   this.$rules = {

      "basic": [{
         token: "constant.language.escape",
         regex: /\\[\\`*_{}[\]()#+\-.!]/
      }, { // latex-style inverted question mark
         token: "text",
         regex: /[?]`/
      }, { // inline r code
         token: "support.function.inline_r_chunk",
         regex: "`r (?:.*?[^`])`"
      }, { // code span `
         token: ["support.function", "support.function", "support.function"],
         regex: "(`+)(.*?[^`])(\\1)"
      },
         inlineNote,
         reference,
         linkByReference,
         linkByUrl,
         urlLink,
         strongStars,
         strongUnderscore,
         emphasisStars,
         emphasisUnderscore
      ],

      "start": [{
         token: "empty_line",
         regex: '^\\s*$',
         next: "allowBlock"
      }, { // latex-style inverted question mark
         token: "text",
         regex: /[?]`/
      }, { // inline r code
         token: "support.function.inline_r_chunk",
         regex: "`r (?:.*?[^`])`"
      }, { // code span `
         token: ["support.function", "support.function", "support.function"],
         regex: "(`+)([^\\r]*?[^`])(\\1)"
      }, { // h1 with equals
         token: "markup.heading.1",
         regex: "^\\={3,}\\s*$",
         next: "fieldblock"
      }, { // h1
         token: "markup.heading.1",
         regex: "^={3,}(?=\\s*$)"
      }, { // h2
         token: "markup.heading.2",
         regex: "^\\-{3,}(?=\\s*$)"
      }, {
         // opening fenced div
         token: "fenced_open",
         regex: "^[:]{3,}\\s*.*$",
         onMatch: function (val, state, stack, line, context) {

            if (!$rainbowFencedDivs) {
               return "keyword.operator";
            }

            var color = (context.fences || 0) % $numFencedDivsColors;
            var close = /^[:]{3,}\s*$/.test(val);

            if (close) {
               context.fences = color + 1;
               return "fenced_div_" + color;
            } else {
               // separating the fence (:::) from the follow up text
               // in case we want to style them differently
               var rx = /^([:]{3,})(.*)$/;
               return [
                  { type: "fenced_div_" + color, value: val.replace(rx, '$1') },
                  { type: "fenced_div_text_" + color, value: val.replace(rx, '$2') },
               ];
            }
         },
         next: "start"
      }, {
         token: function (value) {
            return "markup.heading." + value.length;
         },
         regex: /^#{1,6}/,
         next: "header"
      }, { // ioslides-style bullet
         token: "string.blockquote",
         regex: "^\\s*>\\s*(?=[-])"
      }, { // block quote
         token: "string.blockquote",
         regex: "^\\s*>\\s*",
         next: "blockquote"
      },
         inlineNote,
         reference,
         linkByReference,
      { // HR *
         token: "constant.hr",
         regex: "^\\s*[*](?:\\s*[*]){2,}\\s*$",
         next: "allowBlock",
      }, { // HR -
         token: "constant.hr",
         regex: "^\\s*[-](?:\\s*[-]){2,}\\s*$",
         next: "allowBlock",
      }, { // HR _
         token: "constant.hr",
         regex: "^\\s*[_](?:\\s*[_]){2,}\\s*$",
         next: "allowBlock"
      }, { // $ escape
         token: "text",
         regex: "\\\\\\$"
      }, { // MathJax $$
         token: "latex.markup.list.string.begin",
         regex: "\\${2}",
         next: "mathjaxdisplay"
      }, { // MathJax $...$ (org-mode style)
         token: ["latex.markup.list.string.begin", "latex.support.function", "latex.markup.list.string.end"],
         regex: "(\\$)((?:(?:\\\\.)|(?:[^\\$\\\\]))*?)(\\$)"
      }, { // simple links <url>
         token: ["text", "keyword", "text"],
         regex: "(<)(" +
            "(?:https?|ftp|dict):[^'\">\\s]+" +
            "|" +
            "(?:mailto:)?[-.\\w]+\\@[-a-z0-9]+(?:\\.[-a-z0-9]+)*\\.[a-z]+" +
            ")(>)"
      }, {
         // embedded latex command
         token: "keyword",
         regex: "\\\\(?:[a-zA-Z0-9]+|[^a-zA-Z0-9])"
      }, {
         // brackets
         token: "paren.keyword.operator",
         regex: "[{}]"
      }, {
         // pandoc citation
         token: "markup.list",
         regex: "-?\\@[\\w\\d-]+"
      }, {
         token: "text",
         regex: "[^\\*_%$`\\[#<>{}\\\\@\\s!]+"
      }, {
         token: "text",
         regex: "\\\\"
      }, { // list
         token: "text",
         regex: "^\\s*(?:[*+-]|\\d+\\.)\\s+",
         next: "listblock"
      },
         strongStars,
         strongUnderscore,
         emphasisStars,
         emphasisUnderscore,
      { // html comment
         token: "comment",
         regex: "<\\!--",
         next: "html-comment"
      }, {
         include: "basic"
      }],

      "html-comment": [{
         token: "comment",
         regex: "-->",
         next: "start"
      }, {
         defaultToken: "comment.text"
      }],

      // code block
      "allowBlock": [{
         token: "support.function",
         regex: "^ {4}.+",
         next: "allowBlock"
      }, {
         token: "empty_line",
         regex: "^\\s*$",
         next: "allowBlock"
      }, {
         token: "empty",
         regex: "",
         next: "start"
      }],

      "header": [{
         regex: "$",
         next: "start"
      }, {
         include: "basic"
      }, {
         defaultToken: "heading"
      }],

      "listblock": [{ // Lists only escape on completely blank lines.
         token: "empty_line",
         regex: "^\\s*$",
         next: "start"
      }, { // list
         token: "text",
         regex: "^\\s{0,3}(?:[*+-]|\\d+\\.)\\s+",
         next: "listblock"
      }, { // MathJax $...$ (org-mode style)
         token: ["latex.markup.list.string.begin", "latex.support.function", "latex.markup.list.string.end"],
         regex: "(\\$)((?:(?:\\\\.)|(?:[^\\$\\\\]))*?)(\\$)"
      }, {
         include: "basic", noEscape: true
      }, {
         defaultToken: "text" //do not use markup.list to allow stling leading `*` differently
      }],

      "blockquote": [{ // Blockquotes only escape on blank lines.
         token: "empty_line",
         regex: "^\\s*$",
         next: "start"
      }, {
         token: "constant.language.escape",
         regex: /\\[\\`*_{}[\]()#+\-.!]/
      }, { // latex-style inverted question mark
         token: "text",
         regex: /[?]`/
      }, { // inline r code
         token: "support.function.inline_r_chunk",
         regex: "`r (?:.*?[^`])`"
      }, { // code span `
         token: ["support.function", "support.function", "support.function"],
         regex: "(`+)(.*?[^`])(\\1)"
      },
         inlineNote,
         reference,
         linkByReference,
         linkByUrl,
         urlLink,
         strongStars,
         strongUnderscore,
         emphasisStars,
         emphasisUnderscore,
      {
         defaultToken: "string.blockquote"
      }],

      "fieldblock": [{
         token: function (value) {
            var field = value.slice(0, -1);
            if (slideFields[field])
               return "comment.doc.tag";
            else
               return "text";
         },
         regex: "^" + "[\\w-]+\\:",
         next: "fieldblockvalue"
      }, {
         token: "text",
         regex: "(?=.+)",
         next: "start"
      }],

      "fieldblockvalue": [{
         token: "text",
         regex: "$",
         next: "fieldblock"
      }, {
         token: "text",
         regex: "[^{}]+"
      }],

      "mathjaxdisplay": [{
         token: "latex.markup.list.string.end",
         regex: "\\${2}",
         next: "start"
      }, {
         token: "latex.support.function",
         regex: "[^\\$]+"
      }],

      "mathjaxnativedisplay": [{
         token: "latex.markup.list.string.end",
         regex: "\\\\\\]",
         next: "start"
      }, {
         token: "latex.support.function",
         regex: "[\\s\\S]+?"
      }],

      "mathjaxnativeinline": [{
         token: "latex.markup.list.string.end",
         regex: "\\\\\\)",
         next: "start"
      }, {
         token: "latex.support.function",
         regex: "[\\s\\S]+?"
      }]

   };

   // Support for GitHub blocks
   this.$rules["start"].unshift(
      {
         token: "support.function",
         regex: "^\\s*`{3,16}(?!`)",
         onMatch: function (value, state, stack, line, context) {
            // Check whether we're already within a chunk. If so,
            // skip this chunk header -- assume that it's embedded
            // within another active chunk.
            context.chunk = context.chunk || {};
            if (context.chunk.state != null) {
               this.next = state;
               return this.token;
            }

            // A chunk header was found; record the state we entered
            // from, and also the width of the chunk header.
            var match = /^\s*((?:`|-)+)/.exec(value);
            context.chunk.width = match[1].length;
            context.chunk.state = state;

            // Update the next state and return the matched token.
            this.next = `github-block-${context.chunk.width}`;
            return this.token;
         }
      }
   );

   var githubBlockExitRules = [
      {
         token: "support.function",
         regex: "^\\s*`{3,16}(?!`)",
         onMatch: function (value, state, stack, line, context) {
            // Check whether the width of this chunk tail matches
            // the width of the chunk header that started this chunk.
            var match = /^\s*((?:`|-)+)/.exec(value);
            var width = match[1].length;
            if (context.chunk.width !== width) {
               this.next = state;
               return this.token;
            }

            // Update the next state and return the matched token.
            this.next = context.chunk.state || "start";
            delete context.chunk;
            return this.token;
         }
      },
      {
         token: "support.function",
         regex: ".+"
      }
   ];

   for (var i = 3; i <= 16; i++) {
      this.$rules[`github-block-${i}`] = githubBlockExitRules;
   }

   this.normalizeRules();
   };
   
oop.inherits(MarkdownHighlightRules, TextHighlightRules);
exports.MarkdownHighlightRules = MarkdownHighlightRules;

});
/*
 * mermaid.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/mermaid", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var MermaidHighlightRules = require("mode/mermaid_highlight_rules").MermaidHighlightRules;

var Mode = function() {
   this.$highlightRules = new MermaidHighlightRules();
   this.$tokenizer = new Tokenizer(this.$highlightRules.getRules());
};
oop.inherits(Mode, TextMode);

(function() {
    this.getNextLineIndent = function(state, line, tab) {
        return this.$getIndent(line);
    };
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * mermaid_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/mermaid_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var MermaidHighlightRules = function() {

   // regexp must not have capturing parentheses
   // regexps are ordered -> the first match is used
   var keywords =
      "sequenceDiagram|participant|graph|subgraph|" +
      "loop|alt|is|opt|else|end|style|linkStyle|classDef|class";

   var keywordMapper = this.createKeywordMapper({
      "keyword": keywords
   }, "identifier", false);

   this.$rules = {

      "start" : [
	  {
	      token : "comment",
	      regex : "%%.*$"
	  },
      {
         token: "keyword",
         merge: false,
         regex: "^\\s*graph\\s+(?:TB|BT|RL|LR|TD)\\s*$"
      },
      {
         token: "keyword",
         merge: false,
         regex: "^\\s*(?:sequenceDiagram|participant|subgraph|loop|alt(?:\\s+is)?|opt|else(?:\\s+is)?|end|style|linkStyle|classDef|class)"
      },
      {
         token : "keyword.operator",
         merge: false,
         regex : ">|\\->|\\-\\->|\\-\\-\\-|\\-\\-|\\-\\.\\->|\\-\\.|\\.\\->|==>|==|\\->>|\\-\\->>|\\-x|\\-\\-x"
      },
      {
         token : "paren.keyword.operator",
         merge : false,
         regex : "[[({\\|]"
      },
      {
         token : "paren.keyword.operator",
         merge : false,
         regex : "[\\])}]"
      },
      {
         token: "markup.list",
         merge: false,
         regex: "Note\\s+(?:left|right)\\s+of"
      },
      {
         token: "markup.list",
         merge: false,
         regex: "<br/>"
      },
      {
         token : "text",
         regex : "\\s+",
         merge : true
      }
      ]
   };
};
oop.inherits(MermaidHighlightRules, TextHighlightRules);

exports.MermaidHighlightRules = MermaidHighlightRules;
});
/*
 * python.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/python", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var PythonHighlightRules = require("mode/python_highlight_rules").PythonHighlightRules;
var PythonFoldMode = require("ace/mode/folding/pythonic").FoldMode;
var Range = require("ace/range").Range;

var Mode = function() {
    this.HighlightRules = PythonHighlightRules;
    this.foldingRules = new PythonFoldMode("\\:");
};
oop.inherits(Mode, TextMode);

(function() {

   this.lineCommentStart = "#";

   this.getLanguageMode = function(position)
   {
      return "Python";
   };

   this.getNextLineIndent = function(state, line, tab, row) {

      var indent = this.$getIndent(line);

      // if this line is a comment, use the same indent
      if (/^\s*[#]/.test(line))
         return indent;

      // detect lines ending with something that should increase indent
      // (nominally, these are open brackets and ':')
      if (/[{([:]\s*(?:$|[#])/.test(line))
         indent += tab;

      // decrease indent following things that 'end' a scope
      if (/^\s*(?:break|continue|pass|raise|return)\b/.test(line))
         indent = indent.substring(0, indent.length - tab.length);

      return indent;

   };

   // outdent the row at 'currentRow', setting its indentation to match
   // the indentation associated with 'requestRow'
   this.$performOutdent = function(session, currentRow, requestRow)
   {
      var currentLine = session.doc.$lines[currentRow];
      var requestLine = session.doc.$lines[requestRow];

      var currentIndent = this.$getIndent(currentLine);
      var requestIndent = this.$getIndent(requestLine);

      if (requestIndent.length < currentIndent.length)
      {
         var range = new Range(currentRow, 0, currentRow, currentIndent.length);
         session.replace(range, requestIndent);
      }

      return true;
   };

   this.$autoOutdentElse = function(state, session, row) 
   {
      // if we're inserting a colon following an 'else', then outdent
      var line = session.doc.$lines[row].substring(0, session.selection.cursor.column);
      var shouldOutdent = /^\s*(?:else|elif)(?:\s|[:])/.test(line);
      if (!shouldOutdent)
         return false;

      // 'else' can bind to 'if', 'elif', 'for', and 'try' blocks, so check
      // for each of these
      for (var i = row - 1; i >= 0; i--)
      {
         var prevLine = session.doc.$lines[i];
         var foundMatch = /^\s*(?:if|elif|for|try)(?:\s|[:])/.test(prevLine);
         if (foundMatch)
         {
            return this.$performOutdent(session, row, i);
         }
      }
   };

   this.$autoOutdentExceptFinally = function(state, session, row)
   {
      // check that this line matches an 'except' or 'finally'
      var line = session.doc.$lines[row].substring(0, session.selection.cursor.column);
      var shouldOutdent = /^\s*(?:except|finally)(?:\s|[:])/.test(line);
      if (!shouldOutdent)
         return false;

      // 'except' and 'finally' will bind to a paired 'try', so look for that
      for (var i = row - 1; i >= 0; i--)
      {
         var prevLine = session.doc.$lines[i];
         var foundMatch = /^\s*(?:try)(?:\s|[:])/.test(prevLine);
         if (foundMatch)
         {
            return this.$performOutdent(session, row, i);
         }
      }

   };

   this.checkOutdent = function(state, line, input)
   {
      this.$lastInput = input;
      return input === ":" || input === " ";
   };

   this.$canAutoOutdent = function(state, session, row)
   {
      // can't auto-outdent at start of line
      var cursor = session.selection.cursor;
      if (cursor.column === 0)
         return false;

      // if the user inserted a ':', then we can auto-outdent
      if (this.$lastInput === ":")
         return true;

      // if the user inserted a space, then attempt to auto-outdent only
      // if the space was inserted after a keyword
      if (this.$lastInput === " ")
      {
         var token = session.getTokenAt(cursor.row, cursor.column - 1) || {};
         var isKeyword = /\bkeyword\b/.test(token.type);
         return isKeyword;
      }

      // false if no cases above matched
      return false;
   };

   this.autoOutdent = function(state, session, row)
   {
      if (!this.$canAutoOutdent(state, session, row))
         return;

      if (this.$autoOutdentElse(state, session, row) ||
          this.$autoOutdentExceptFinally(state, session, row))
      {
         return;
      }

   };

   this.transformAction = function(state, action, editor, session, param) {
      return false;
   };

   this.$id = "mode/python";

}).call(Mode.prototype);

exports.Mode = Mode;

});
/*
 * python_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */


/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */
/*
 * TODO: python delimiters
 */

define("mode/python_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var RainbowParenHighlightRules = require("mode/rainbow_paren_highlight_rules").RainbowParenHighlightRules;
var Utils = require("mode/utils");

var PythonHighlightRules = function() {

    // :r !python3 -c 'from keyword import kwlist; print("|".join(kwlist))'
    var keywords = (
        "False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield"
    );

    var builtinConstants = (
        "NotImplemented|Ellipsis|__debug__"
    );

    // https://docs.python.org/3/library/functions.html
    var builtinFunctions = (
        "abs|all|any|ascii|basestring|bin|bool|breakpoint|bytearray|bytes|callable|" +
        "chr|classmethod|cmp|compile|complex|delattr|dict|dir|divmod|eumerate|" +
        "eval|execfile|exec|filter|float|format|frozenset|getattr|globals|hasattr|" +
        "hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|" +
        "locals|long|map|max|memoryview|min|next|object|oct|open|ord|pow|print|" +
        "property|range|raw_input|reduce|reload|repr|reversed|round|set|setattr|slice|" +
        "sorted|staticmethod|str|sum|super|tuple|type|unichr|unicode|vars|xrange|zip|" +
        "__import__"
    );

    //var futureReserved = "";
    var keywordMapper = this.createKeywordMapper({
        "invalid.deprecated": "debugger",
        "support.function": builtinFunctions,
        //"invalid.illegal": futureReserved,
        "constant.language": builtinConstants,
        "keyword": keywords
    }, "identifier");

    var strPre = "(?:b|B|br|Br|bR|BR|rb|rB|Rb|RB|r|u|R|U|f|F|fr|Fr|fR|FR|rf|rF|Rf|RF)?";

    var decimalInteger = "(?:(?:[1-9]\\d*)|(?:0))";
    var octInteger = "(?:0[oO]?[0-7]+)";
    var hexInteger = "(?:0[xX][\\dA-Fa-f]+)";
    var binInteger = "(?:0[bB][01]+)";
    var integer = "(?:" + decimalInteger + "|" + octInteger + "|" + hexInteger + "|" + binInteger + ")";

    var exponent = "(?:[eE][+-]?\\d+)";
    var fraction = "(?:\\.\\d+)";
    var intPart = "(?:\\d+)";
    var pointFloat = "(?:(?:" + intPart + "?" + fraction + ")|(?:" + intPart + "\\.))";
    var exponentFloat = "(?:(?:" + pointFloat + "|" +  intPart + ")" + exponent + ")";
    var floatNumber = "(?:" + exponentFloat + "|" + pointFloat + ")";

    var stringEscape =  "\\\\(x[0-9A-Fa-f]{2}|[0-7]{3}|[\\\\abfnrtv'\"]|U[0-9A-Fa-f]{8}|u[0-9A-Fa-f]{4})";

    this.$rules = {
        "start" : [  {
            // chunk metadata comments
            token : "comment.doc.tag",
            regex : "#\\s*[|].*$",
            next  : "start"
        }, {
            token : "comment",
            regex : "#.*$"
        }, {
            // decorators
            token : "constant.language",
            regex : "@[a-zA-Z_][a-zA-Z0-9._]*\\b",
        }, {
            token : "string",           // multi line """ string start
            regex : strPre + '"{3}',
            next : "qqstring3"
        }, {
            token : "string",           // " string
            regex : strPre + '"(?=.)',
            next : "qqstring"
        }, {
            token : "string",           // multi line ''' string start
            regex : strPre + "'{3}",
            next : "qstring3"
        }, {
            token : "string",           // ' string
            regex : strPre + "'(?=.)",
            next : "qstring"
        }, {
            token : "constant.numeric", // imaginary
            regex : "(?:" + floatNumber + "|\\d+)[jJ]\\b"
        }, {
            token : "constant.numeric", // float
            regex : floatNumber
        }, {
            token : "constant.numeric", // long integer
            regex : integer + "[lL]\\b"
        }, {
            token : "constant.numeric", // integer
            regex : integer + "\\b"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_][a-zA-Z0-9_]*\\b"
        }, {
            token : "keyword.operator",
            regex : "//=|\\*\\*=|>>=|<<=|//|\\*\\*|==|!=|>=|<=|:=|>>|<<|\\+=|-=|\\*=|/=|&=|%=|\\|=|\\^=|\\+|-|\\*|/|%|>|<|\\^|~|\\||&|=|:|\\.|;|,",
            merge : false
        },
        RainbowParenHighlightRules.getParenRule(),
        {
            token : "text",
            regex : "\\s+"
        } ],
        "qqstring3" : [ {
            token : "constant.language.escape",
            regex : stringEscape
        }, {
            token : "string", // multi line """ string end
            regex : '"{3}',
            next : "start"
        }, {
            defaultToken : "string"
        } ],
        "qstring3" : [ {
            token : "constant.language.escape",
            regex : stringEscape
        }, {
            token : "string",  // multi line ''' string end
            regex : "'{3}",
            next : "start"
        }, {
            defaultToken : "string"
        } ],
        "qqstring" : [{
            token : "constant.language.escape",
            regex : stringEscape
        }, {
            token : "string",
            regex : "\\\\$",
            next  : "qqstring"
        }, {
            token : "string",
            regex : '"|$',
            next  : "start"
        }, {
            defaultToken: "string"
        }],
        "qstring" : [{
            token : "constant.language.escape",
            regex : stringEscape
        }, {
            token : "string",
            regex : "\\\\$",
            next  : "qstring"
        }, {
            token : "string",
            regex : "'|$",
            next  : "start"
        }, {
            defaultToken: "string"
        }]

    };

   Utils.embedQuartoHighlightRules(this);
   this.normalizeRules();
};

oop.inherits(PythonHighlightRules, TextHighlightRules);

exports.PythonHighlightRules = PythonHighlightRules;
});
/*
 * r.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/r", ["require", "exports", "module"], function(require, exports, module)
{
   var Editor = require("ace/editor").Editor;
   var EditSession = require("ace/edit_session").EditSession;
   var Range = require("ace/range").Range;
   var oop = require("ace/lib/oop");
   var TextMode = require("ace/mode/text").Mode;
   var Tokenizer = require("ace/tokenizer").Tokenizer;
   var TextHighlightRules = require("ace/mode/text_highlight_rules")
         .TextHighlightRules;
   var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
   var RCodeModel = require("mode/r_code_model").RCodeModel;
   var RMatchingBraceOutdent = require("mode/r_matching_brace_outdent").RMatchingBraceOutdent;
   var AutoBraceInsert = require("mode/auto_brace_insert").AutoBraceInsert;
   var unicode = require("ace/unicode");

   var Mode = function(suppressHighlighting, session)
   {
      if (suppressHighlighting)
         this.$tokenizer = new Tokenizer(new TextHighlightRules().getRules());
      else
         this.$tokenizer = new Tokenizer(new RHighlightRules().getRules());

      this.codeModel = new RCodeModel(session, this.$tokenizer);
      this.foldingRules = this.codeModel;
      this.$outdent = new RMatchingBraceOutdent(this.codeModel);
   };
   oop.inherits(Mode, TextMode);

   (function()
   {
      this.getLanguageMode = function(position) {
         return "R";
      };

      this.checkOutdent = function(state, line, input) {
         return this.$outdent.checkOutdent(state, line, input);
      };

      this.autoOutdent = function(state, session, row) {
         return this.$outdent.autoOutdent(state, session, row);
      };

      this.tokenRe = new RegExp("^[" + unicode.wordChars + "._]+", "g");
      this.nonTokenRe = new RegExp("^(?:[^" + unicode.wordChars + "._]|\\s)+", "g");

      // NOTE: these override fields used for 'auto_brace_insert'
      this.$complements = {
               "(": ")",
               "[": "]",
               '"': '"',
               "'": "'",
               "{": "}",
               "`": "`"
            };
      this.$reOpen  = /^[{(\["'`]$/;
      this.$reClose = /^[})\]"'`]$/;

      this.getNextLineIndent = function(state, line, tab, row)
      {
         return this.codeModel.getNextLineIndent(state, line, tab, row);
      };

      this.allowAutoInsert = this.smartAllowAutoInsert;

      this.getIndentForOpenBrace = function(openBracePos)
      {
         return this.codeModel.getIndentForOpenBrace(openBracePos);
      };

      this.$getIndent = function(line) {
         var match = line.match(/^(\s+)/);
         if (match) {
            return match[1];
         }

         return "";
      };

      this.$id = "mode/r";
   }).call(Mode.prototype);
   exports.Mode = Mode;
});
/*
 * r_code_model.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/r_code_model", ["require", "exports", "module"], function(require, exports, module) {

var Range = require("ace/range").Range;
var TokenIterator = require("ace/token_iterator").TokenIterator;
var RTokenCursor = require("mode/token_cursor").RTokenCursor;
var Utils = require("mode/utils");

var $verticallyAlignFunctionArgs = false;

function comparePoints(pos1, pos2)
{
   if (pos1.row != pos2.row)
      return pos1.row - pos2.row;
   return pos1.column - pos2.column;
}

function isOneOf(object, array)
{
   for (var i = 0; i < array.length; i++)
      if (object === array[i])
         return true;
   return false;
}

function isControlFlowFunctionKeyword(value)
{
   return value === "if" ||
          value === "for" ||
          value === "while" ||
          value === "repeat" ||
          value === "function";
}

var ScopeManager = require("mode/r_scope_tree").ScopeManager;
var ScopeNode = require("mode/r_scope_tree").ScopeNode;

var RCodeModel = function(session, tokenizer,
                          statePattern, codeBeginPattern, codeEndPattern) {

   // TODO: Use this.$session.bgTokenizer instead of having a duplicate tokenizer...
   this.$session = session;
   this.$doc = session.getDocument();
   this.$tokenizer = tokenizer;
   this.$tokens = new Array(this.$doc.getLength());
   this.$endStates = new Array(this.$doc.getLength());
   this.$contexts = new Array(this.$doc.getLength());
   this.$statePattern = statePattern;
   this.$codeBeginPattern = codeBeginPattern;
   this.$codeEndPattern = codeEndPattern;
   this.$scopes = new ScopeManager(ScopeNode);

   var $firstChange = true;
   var onChangeMode = function(data, session)
   {
      if ($firstChange)
      {
         $firstChange = false;
         return;
      }

      this.$doc.off('change', onDocChange);
      this.$session.off('changeMode', onChangeMode);
   }.bind(this);

   var onDocChange = function(evt)
   {
      this.$onDocChange(evt);
   }.bind(this);

   this.$session.on('changeMode', onChangeMode);
   this.$doc.on('change', onDocChange);
};

(function () {

   var contains = Utils.contains;

   this.getTokenCursor = function() {
      return new RTokenCursor(this.$tokens, 0, 0, this);
   };

   this.$complements = {
      '(': ')',
      ')': '(',
      '[': ']',
      ']': '[',
      '{': '}',
      '}': '{'
   };

   var $normalizeWhitespace = function(text) {
      text = text.trim();
      text = text.replace(/[\n\s]+/g, " ");
      return text;
   };

   var $truncate = function(text, width) {

      if (typeof width === "undefined")
         width = 80;

      if (text.length > width)
         text = text.substring(0, width) + "...";

      return text;
   };

   var $normalizeAndTruncate = function(text, width) {
      return $truncate($normalizeWhitespace(text), width);
   };

   function pFunction(t)
   {
      return t.type == 'keyword' && (t.value == 'function' || t.value == '\\');
   }

   function pAssign(t)
   {
      return /\boperator\b/.test(t.type) && /^(=|<-|<<-)$/.test(t.value);
   }

   function pIdentifier(t)
   {
      return /\bidentifier\b/.test(t.type);
   }

   // Find the associated function token from an open brace, e.g.
   //
   //   foo <- function(a, b, c) {
   //          ^<<<<<<<<<<<<<<<<<^
   function findAssocFuncToken(tokenCursor)
   {
      var clonedCursor = tokenCursor.cloneCursor();
      if (clonedCursor.currentValue() !== "{")
         return false;
      if (!clonedCursor.moveBackwardOverMatchingParens())
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!pFunction(clonedCursor.currentToken()))
         return false;

      tokenCursor.$row = clonedCursor.$row;
      tokenCursor.$offset = clonedCursor.$offset;
      return true;
   }

   // Find the associated test_that() token from an open brace, e.g.
   //
   // test_that("foo() does this", {
   // ^<<<<<<<<<<<<<<<<<<<<<<<<<<<<^
   function findAssocTestToken(tokenCursor)
   {
      var clonedCursor = tokenCursor.cloneCursor();
      if (clonedCursor.currentValue() !== "{")
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!clonedCursor.currentToken().value == ",")
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!clonedCursor.currentToken().type == "string")
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!clonedCursor.currentToken().value == "(")
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      var token = clonedCursor.currentToken();
      return pIdentifier(token) && token.value == "test_that";
   }

   // Determine whether the token cursor lies within the
   // argument list for a control flow statement, e.g.
   //
   //    if (foo &&
   //        (bar
   //         ^
   function isWithinControlFlowArgList(tokenCursor)
   {
      while (tokenCursor.findOpeningBracket("(") &&
             tokenCursor.moveToPreviousToken())
         if (isOneOf(
            tokenCursor.currentValue(),
            ["if", "for", "while"]))
             return true;

      return false;
   }

   // Move from the function token to the end of a function name.
   // Note that it is legal to define functions in multi-line strings,
   // hence the somewhat awkward name / interface.
   //
   //     "some function" <- function(a, b, c) {
   //                   ^~~~~^
   function moveFromFunctionTokenToEndOfFunctionName(tokenCursor)
   {
      var clonedCursor = tokenCursor.cloneCursor();
      if (!pFunction(clonedCursor.currentToken()))
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!pAssign(clonedCursor.currentToken()))
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;

      tokenCursor.$row = clonedCursor.$row;
      tokenCursor.$offset = clonedCursor.$offset;
      return true;
   }

   // Move from the function call token to the end of the
   // assigned token
   //
   //     result <- foo(a, b, c) {
   //          ^~~~~^
   function moveFromFunctionCallTokenToEndOfResultName(tokenCursor)
   {
      var clonedCursor = tokenCursor.cloneCursor();
      if (!pIdentifier(clonedCursor.currentToken()))
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;
      if (!pAssign(clonedCursor.currentToken()))
         return false;
      if (!clonedCursor.moveToPreviousToken())
         return false;

      tokenCursor.$row = clonedCursor.$row;
      tokenCursor.$offset = clonedCursor.$offset;
      return true;
   }

   this.getFunctionsInScope = function(pos) {
      this.$buildScopeTreeUpToRow(pos.row);
      return this.$scopes.getFunctionsInScope(pos);
   };

   this.getAllFunctionScopes = function(row) {
      if (typeof row === "undefined")
         row = this.$doc.getLength();
      this.$buildScopeTreeUpToRow(row);
      return this.$scopes.getAllFunctionScopes();
   };

   function pInfix(token)
   {
      return /\binfix\b/.test(token.type) || token.value === "|>";
   }

   // If the token cursor lies within an infix chain, try to retrieve:
   // 1. The data object name, and
   // 2. Any custom variable names (e.g. set through 'mutate', 'summarise')
   this.getDataFromInfixChain = function(tokenCursor)
   {
      var data = this.moveToDataObjectFromInfixChain(tokenCursor);

      var additionalArgs = [];
      var excludeArgs = [];
      var name = "";
      var excludeArgsFromObject = false;
      if (data !== false)
      {
         if (data.excludeArgsFromObject)
            excludeArgsFromObject = data.excludeArgsFromObject;

         var clone = tokenCursor.cloneCursor();
         clone.findStartOfEvaluationContext();

         name = this.$doc.getTextRange(new Range(
            clone.currentPosition().row,
            clone.currentPosition().column,

            tokenCursor.currentPosition().row,
            tokenCursor.currentPosition().column + tokenCursor.currentValue().length
         ));

         // name = tokenCursor.currentValue();
         additionalArgs = data.additionalArgs;
         excludeArgs = data.excludeArgs;

         if (data.cancel == true)
         {
            excludeArgsFromObject = true;
            additionalArgs = [];
            excludeArgs = [];
         }
      }

      return {
         "name": name,
         "additionalArgs": additionalArgs,
         "excludeArgs": excludeArgs,
         "excludeArgsFromObject": excludeArgsFromObject
      };

   };

   var $dplyrMutaterVerbs = [
      "mutate", "summarise", "summarize", "rename", "transmute",
      "select", "rename_vars",
      "inner_join", "left_join", "right_join", "semi_join", "anti_join",
      "outer_join", "full_join"
   ];

   var unquote = function(value) {
      var match = /^([`'"])(.*)\1$/.exec(value);
      if (match != null) {
         var replace = new RegExp("\\\\" + match[1]);
         return match[2].replace(replace, match[1]);
      }
      return value;
   }

   // Add arguments from a function call in a chain.
   //
   //     select(x, y = 1)
   //     ^~~~~~~|~~|~~~~x
   var addDplyrArguments = function(cursor, data, limit, fnName)
   {
      if (!cursor.moveToNextToken())
         return false;

      if (cursor.currentValue() !== "(")
         return false;

      if (!cursor.moveToNextToken())
         return false;

      if (cursor.currentValue() === ")")
         return false;

      if (cursor.hasType("identifier"))
      {
         var value = unquote(cursor.currentValue());
         data.additionalArgs.push(value);
      }

      if (fnName === "rename")
      {
         if (!cursor.moveToNextToken())
            return false;

         if (cursor.currentValue() === "=")
         {
            if (!cursor.moveToNextToken())
               return false;

            var value = unquote(cursor.currentValue());
            data.excludeArgs.push(value);
         }
      }

      if (fnName === "select")
      {
         data.excludeArgsFromObject = true;
      }

      do
      {
         if (cursor.currentValue() === ")")
            break;

         if ((cursor.$row > limit.$row) ||
             (cursor.$row === limit.$row && cursor.$offset >= limit.$offset))
            break;

         if (cursor.fwdToMatchingToken())
         {
            continue;
         }

         if (cursor.currentValue() === ",")
         {
            if (!cursor.moveToNextToken())
               return false;

            if (cursor.hasType("identifier"))
            {
               var value = unquote(cursor.currentValue());
               data.additionalArgs.push(value);
            }

            if (!cursor.moveToNextToken())
               return false;

            if (cursor.currentValue() === "=")
            {
               if (isOneOf(fnName, ["rename", "rename_vars"]))
               {
                  if (!cursor.moveToNextToken())
                     return false;

                  if (cursor.hasType("identifier"))
                  {
                     var value = unquote(cursor.currentValue());
                     data.excludeArgs.push(value);
                  }
               }
            }
            else
            {
               if (!cursor.moveToPreviousToken())
                  return false;
            }
         }

      } while (cursor.moveToNextToken());

      return true;

   };

   var findChainScope = function(cursor)
   {
      var clone = cursor.cloneCursor();
      while (clone.findOpeningBracket("(", false))
      {
         // Move off of the opening paren
         if (!clone.moveToPreviousToken())
            return false;

         // Move off of identifier
         if (!clone.moveToPreviousToken())
            return false;

         // Move over '::' qualifiers
         if (clone.currentValue() === "::" || clone.currentValue() === ":::")
         {
            // Move of to pkg identifier
            if (!clone.moveToPreviousToken())
               return false;

            // Move off of identifier
            if (!pIdentifier(clone.currentToken()) || !clone.moveToPreviousToken())
               return false;
         }

         // If it's an infix operator, we use this scope
         // Ensure it's a '%%' operator (allow for other pipes)
         if (pInfix(clone.currentToken()))
         {
            cursor.$row = clone.$row;
            cursor.$offset = clone.$offset;
            return true;
         }

         // keep trying!

      }

      // give up
      return false;

   };

   // Attempt to move a token cursor from a function call within
   // a chain back to the starting data object.
   //
   //     df %.% foo %>>% bar() %>% baz(foo,
   //     ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^
   this.moveToDataObjectFromInfixChain = function(tokenCursor)
   {
      // Find an opening paren associated with the nearest chain,
      // Find the outermost opening paren
      var clone = tokenCursor.cloneCursor();
      if (!findChainScope(clone))
         return false;

      // Fill custom args
      var data = {
         additionalArgs: [],
         excludeArgs: [],
         cancel: false
      };

      // Repeat the walk -- keep walking as we can find '%%'
      while (true)
      {
         if (clone.$row === 0 && clone.$offset === 0)
         {
            tokenCursor.$row = 0;
            tokenCursor.$offset = 0;
            return data;
         }

         // Move over parens to identifier if necessary
         //
         //    foo(bar, baz)
         //    ^~~~~~~~~~~~^
         clone.moveBackwardOverMatchingParens();

         // Move off of '%>%' (or '(') onto identifier
         if (!clone.moveToPreviousToken())
            return false;

         // If this identifier is a dplyr 'mutate'r, then parse
         // those variables.
         var value = clone.currentValue();

         // pull() cancels the column completions
         if (value === "pull")
            data.cancel = true;

         if (contains($dplyrMutaterVerbs, value))
            addDplyrArguments(clone.cloneCursor(), data, tokenCursor, value);

         // Move off of identifier, on to new infix operator.
         // If this fails (e.g. we're already at the start of the document)
         // then just return the associated data object.
         if (!clone.moveToPreviousToken())
         {
            tokenCursor.$row = clone.$row;
            tokenCursor.$offset = clone.$offset;
            return data;
         }

         // Move over '::' qualifiers
         if (clone.currentValue() === "::" || clone.currentValue() === ":::")
         {
            // Move off of ::
            if (!clone.moveToPreviousToken())
               return false;

            // Move off of identifier
            if (!clone.moveToPreviousToken())
               return false;
         }

         // We should be on an infix operator now. If we are, keep walking;
         // if not, then the identifier we care about is the next token.
         if (!pInfix(clone.currentToken()))
            break;
      }

      if (!clone.moveToNextToken())
         return false;

      tokenCursor.$row = clone.$row;
      tokenCursor.$offset = clone.$offset;
      return data;
   };

   function addForInToken(tokenCursor, scopedVariables)
   {
      var clone = tokenCursor.cloneCursor();
      if (clone.currentValue() !== "for")
         return false;

      if (!clone.moveToNextToken())
         return false;

      if (clone.currentValue() !== "(")
         return false;

      if (!clone.moveToNextToken())
         return false;

      var maybeForInVariable = clone.currentValue();
      if (!clone.moveToNextToken())
         return false;

      if (clone.currentValue() !== "in")
         return false;

      scopedVariables[maybeForInVariable] = "variable";
      return true;
   }

   // Moves out of an argument list for a function, e.g.
   //
   //     x <- func(a, b|
   //          ^~~~~~~~~^
   //
   // The cursor will be placed on the associated 'func' token
   // on success, and unmoved on failure.
   var moveOutOfArgList = function(tokenCursor)
   {
      var clone = tokenCursor.cloneCursor();
      if (!clone.findOpeningBracket(["(", "["], true))
         return false;

      if (!clone.moveToPreviousToken())
         return false;

      tokenCursor.$row = clone.$row;
      tokenCursor.$offset = clone.$offset;
      return true;
   };

   this.getVariablesInScope = function(pos) {
      var tokenCursor = this.getTokenCursor();
      if (!tokenCursor.moveToPosition(pos))
         return [];

      // If we're in a function call, avoid grabbing the parameters and
      // function name itself within the call. This is so that in e.g.
      //
      //     func <- foo(x = 1, y = 2, |
      //
      // we don't pick up 'func', 'x', and 'y' as potential completions
      // since they will not be valid in all contexts
      //
      // same for these calls:
      //
      //     y <- data[ x = 1, y = 2, |
      //
      // we don't pick up 'x', 'data', or 'y'
      while (moveOutOfArgList(tokenCursor))
      {
         var moved = false;

         if (pFunction(tokenCursor.currentToken()))
         {
            moved = moveFromFunctionTokenToEndOfFunctionName(tokenCursor);
         }
         else
         {
            moved = moveFromFunctionCallTokenToEndOfResultName(tokenCursor);
         }

         // previous statements will move the cursor as necessary
         if (moved)
            tokenCursor.findStartOfEvaluationContext();
      }

      var scopedVariables = {};
      do
      {
         if (tokenCursor.bwdToMatchingToken())
            continue;

         // Handle 'for (x in bar)'
         addForInToken(tokenCursor, scopedVariables);

         // Default -- assignment case
         if (pAssign(tokenCursor.currentToken()))
         {
            // Check to see if this is a function (simple check)
            var type = "variable";
            var functionCursor = tokenCursor.cloneCursor();
            if (functionCursor.moveToNextToken())
            {
               if (functionCursor.currentValue() === "function")
               {
                  type = "function";
               }
            }

            var clone = tokenCursor.cloneCursor();
            if (!clone.moveToPreviousToken()) continue;

            if (pIdentifier(clone.currentToken()))
            {
               var arg = clone.currentValue();
               scopedVariables[arg] = type;
               continue;
            }

         }
      } while (tokenCursor.moveToPreviousToken());

      var result = [];
      for (var key in scopedVariables)
         result.push({
            "token": key,
            "type": scopedVariables[key]
         });

      result.sort();
      return result;
   };

   // Get function arguments, starting at the start of a function definition, e.g.
   //
   // x <- function(a = 1, b = 2, c = list(a = 1, b = 2), ...)
   //      ?~~~~~~~?^~~~~~~^~~~~~~^~~~~~~~~~~~~~~~~~~~~~~~^~~|
   function $getFunctionArgs(tokenCursor)
   {
      if (pFunction(tokenCursor.currentToken()))
         if (!tokenCursor.moveToNextToken())
            return [];

      if (tokenCursor.currentValue() === "(")
         if (!tokenCursor.moveToNextToken())
            return [];

      if (tokenCursor.currentValue() === ")")
         return [];

      var functionArgs = [];
      if (pIdentifier(tokenCursor.currentToken()))
         functionArgs.push(tokenCursor.currentValue());

      while (tokenCursor.moveToNextToken())
      {
         if (tokenCursor.fwdToMatchingToken())
            continue;

         if (tokenCursor.currentValue() === ")")
            break;

         // Yuck: '...' and ',' can get tokenized together as
         // text. All we can really do is ask if a particular token is
         // type 'text' and ends with a comma.
         // Once we encounter such a token, we look ahead to find an
         // identifier (it signifies an argument name)
         if (tokenCursor.currentValue() === ",")
         {
            while (tokenCursor.currentValue() === ",")
               if (!tokenCursor.moveToNextToken())
                  break;

            if (pIdentifier(tokenCursor.currentToken()))
               functionArgs.push(tokenCursor.currentValue());
         }
      }
      return functionArgs;

   }

   function $extractYamlTitle(session)
   {
      var row = 0;

      // Protect against unclosed YAML blocks in large documents.
      // It seems unlikely that a YAML block would span more than
      // 100 lines...
      var n = Math.min(session.getLength(), 100);

      // Default title (in case a 'title:' field is not found)
      var title = "Title";

      while (row++ < n)
      {
         var line = session.getLine(row);
         if (/^\s*[-]{3}\s*$/.test(line))
            break;

         var match = /^\s*title:\s+(.*?)\s*$/.exec(line);
         if (match !== null)
         {
            title = match[1];
            break;
         }
      }

      return Utils.stripEnclosingQuotes(title.trim());

   }

   this.$buildScopeTreeUpToRow = function(maxRow)
   {
      function getChunkLabel(session, reOptions, comment, iterator) {

         if (typeof reOptions === "undefined")
            return "";

         var match = reOptions.exec(comment);
         if (match)
         {
            var value = match[1];
            var values = value.split(',');
            if (values.length > 0)
            {
               // If first arg has no =, it's a label
               var first = values[0];
               if (!/=/.test(first)) {
                  var label = first.replace(/(^\s+)|(\s+$)/g, '');
                  if (label.length)
                     return label;
               }

               for (var i = 0; i < values.length; i++) {
                  match = /^\s*label\s*=\s*(.*)$/.exec(values[i]);
                  if (match)
                     return Utils.stripEnclosingQuotes(match[1].trim());
               }
            }
         }

         // then look for yaml label, i.e.
         //
         // ```{r}
         // #| label: foo
         var it = iterator.clone();
         var token = it.moveToNextToken();
         while (token != null && token.type.startsWith("comment"))
         {
            var value = session.getLine(it.$row);
            var labelRegex = /^#\|\s*label\s*:\s*(.*)$/;
            if (labelRegex.test(value))
               return value.replace(labelRegex, "$1");

            token = it.moveToStartOfNextRowWithTokens();
         }

         return null;
      }

      var modeId = this.$session.getMode().$id;

      // Nudge the maxRow ahead a bit -- some functions may request
      // the tree to be built up to a particular row, but we want to
      // build a bit further ahead in case some lookahead is required.
      maxRow = Math.min(maxRow + 30, this.$doc.getLength() - 1);

      // Check if the scope tree has already been built up to this row.
      var scopeRow = this.$scopes.parsePos.row;
      if (scopeRow >= maxRow)
          return scopeRow;

      // We explicitly use a TokenIterator rather than a TokenCursor here.
      // We want to iterate over all token types here (including non-R code)
      // and the R code model, by default, will only tokenize within R chunks within
      // multi-mode documents.
      //
      // Create a TokenIterator and place it as the previous parse position (as stored
      // by a previous scope-tree building request). This avoids re-building portions
      // of the tree that have been already built.
      var iterator = new TokenIterator(this.$session);

      // Tokenize eagerly up to the desired row. Note that we have to tokenize
      // in two places -- the internal Ace tokenizer (whose tokens are used by
      // the token iterator here), and also the R code model's tokenizer (which
      // maintains its own set of R tokens used for indentation). In a perfect
      // world, we wouldn't maintain a separate set of tokens for our R code
      // model, but ...
      iterator.tokenizeUpToRow(maxRow);
      this.$tokenizeUpToRow(maxRow);


      var row = this.$scopes.parsePos.row;
      var column = this.$scopes.parsePos.column;
      iterator.moveToPosition({row: row, column: column}, true);

      var token = iterator.getCurrentToken();

      // If this failed, give up.
      if (token == null)
         return row;

      // Grab local state that we'll use when building the scope tree.
      var value = token.value;
      var type = token.type;
      var position = iterator.getCurrentTokenPosition();
      var chunkCount = this.$scopes.getChunkCount()

      do
      {
         // Bail if we've stepped past the max row.
         if (iterator.$row > maxRow)
            break;

         // Cache access to the current token + cursor.
         value = token.value;
         type = token.type;
         position = iterator.getCurrentTokenPosition();

         // Skip roxygen comments.
         var state = Utils.getPrimaryState(this.$session, position.row);
         if (state === "rdoc-start") {
            iterator.moveToEndOfRow();
            continue;
         }

         // Figure out if we're in R mode. This is a hack since
         // unfortunately the code model is handling both R and
         // non-R modes right now -- for example, '{' should only
         // create a scope when encountered within a chunk.
         var isInRMode = true;
         if (this.$codeBeginPattern)
            isInRMode = /^r-/.test(state);

         // Add Markdown headers.
         //
         // The markdown highlight rules are a bit strange in that
         // 'types' are not really consistent. Likely due to the lack
         // of general lookahead / lookbehind in the Ace tokenizer. We
         // just manually check for each 'state'.
         //
         // Furthermore, the Ace tokenizer does not handle
         // bold or italic headers, e.g. this header is tokenized as:
         //
         //    ## __Foo__
         //    ^              markup.heading.2
         //      ^            heading
         //       ^^^^^^^     string.strong
         //
         // So make sure we manually scrape the header text out of the line.
         if (Utils.startsWith(type, "markup.heading"))
         {
            // Track both the 'start' and the 'end' of the label position.
            // The scope 'begins' after the end of the label, although we want
            // to include the label as part of the 'preamble'. Note that this is
            // necessary for the scope tree to be able to properly incrementally
            // tokenize; if the start position were set at the start of the label then
            // this scope would get duplicated within the scope tree.
            var label = "";
            var labelStartPos = {row: position.row, column: 0};
            var labelEndPos = {row: position.row + 1, column: 0};
            var depth = 0;

            // Check if this is a single-line heading, e.g. '# foo'.
            if (/^\s*#+\s*$/.test(value))
            {
               depth = value.split("#").length - 1;
               var line = this.$session.getLine(position.row);
               label = line.replace(/^\s*[#]+\s*/, "");
            }

            // Check if this is a 2-line heading, e.g.
            //
            //    A title
            //    -------
            else if (/^[-=]{3,}\s*$/.test(value))
            {
               depth = value[0] === "=" ? 1 : 2;
               label = this.$session.getLine(position.row - 1).trim();
               labelStartPos.row--;

               // If we have no title, bail (e.g. for horizontal rules)
               if (label.length === 0)
                  continue;
            }

            // Trim off Markdown IDs from the label.
            var reBraces = /{.*}\s*$/;
            label = label.replace(reBraces, "");

            // Make sure we have a non-empty label
            label = label || "(Untitled)"

            // Add to scope tree
            this.$scopes.onMarkdownHead(label, labelStartPos, labelEndPos, depth, true);
         }

         // Add R-comment sections; e.g.
         //
         //    # Section ----
         //
         // Note that sections can only be closed implicitly by new
         // sections following later in the document.
         else if (isInRMode && /\bsectionhead\b/.test(type))
         {
            // Extract the section name from the header. These
            // have the form e.g.
            //
            //    # Foo ----
            //
            // but note that the section name can be empty, and e.g.
            //
            //    #####
            //
            // is accepted for folding purposes.
            var label = "(Untitled)";
            var matchStart = /[^#=-\s]/.exec(value);
            if (matchStart) {
               label = value.substr(matchStart.index);
               label = label.replace(/\s*[#=-]+\s*$/, "");
            }

            // Detect Markdown-style headers, of the form
            //
            //   ## Header 2 ----
            //
            // When we have such a header, we can provide a depth.
            var match = /^\s*([#]+)\s*[^#]/.exec(value);
            if (match != null)
            {
               // compute depth -- if the depth seems unlikely / large,
               // then treat it as just a plain section (similar to how
               // HTML only provides <h1> through <h6>)
               var depth = match[1].length;
               if (depth > 6)
               {
                  this.$scopes.onSectionStart(label, position);
               }
               else
               {
                  var labelStartPos = {row: position.row, column: 0};
                  var labelEndPos = {row: position.row, column: Infinity};
                  this.$scopes.onMarkdownHead(label, labelStartPos, labelEndPos, depth, false);
               }
            }
            else
            {
               this.$scopes.onSectionStart(label, position);
            }

         }

         // Sweave
         //
         // Handle Sweave sections.
         // TODO: Maybe handle '\begin{}' and '\end{}' pairs?
         else if (!isInRMode &&
                  modeId === "mode/sweave" &&
                  type === "keyword" &&
                  position.column === 0 &&
                  value.indexOf("\\") === 0 && (
                     value === "\\chapter" ||
                     value === "\\section" ||
                     value === "\\subsection" ||
                     value === "\\subsubsection"
                  ))
         {
            // Infer the depth of the label.
            var depth = 1;
            if (value === "\\chapter")
               depth = 2;
            else if (value === "\\section")
               depth = 3;
            else if (value === "\\subsection")
               depth = 4;
            else if (value === "\\subsubsection")
               depth = 5;

            var line = this.$doc.getLine(position.row);

            var reSection = /{([^}]*)}/;
            var match = reSection.exec(line);

            var label = "";
            if (match != null)
               label = match[1];

            var labelStartPos = {row: position.row, column: 0};
            var labelEndPos = {row: position.row, column: Infinity};

            this.$scopes.onMarkdownHead(label, labelStartPos, labelEndPos, depth, true);
         }

         // Check specifically for YAML header boundaries ('---')
         //
         // TODO: We should encode the state we're transitioning into
         // in the token type, so we don't have to 'guess' based on the
         // value.
         else if (/\bcodebegin\b/.test(type) && value === "---")
         {
            var title = $extractYamlTitle(this.$session);
            this.$scopes.onSectionStart(title, position, {isYaml: true});
         }

         else if (/\bcodeend\b/.test(type) && value === "---")
         {
            position.column = Infinity;
            this.$scopes.onSectionEnd(position);
         }

         // Check specifically for C++ chunks. We don't want these
         // to create their own 'chunks' within R Markdown documents
         // (as otherwise they screw with the R Notebook chunk scoping)
         else if (modeId === "mode/rmarkdown" &&
                  /\bcodebegin\b/.test(type) &&
                  value.trim().indexOf("/***") === 0)
         {
            this.$scopes.onSectionStart("(R Code Chunk)", position);
         }

         else if (modeId === "mode/rmarkdown" &&
                  /\bcodeend\b/.test(type) &&
                  value.trim().indexOf("*/") === 0)
         {
            this.$scopes.onSectionEnd(position);
         }

         // Add chunks to the scope tree; e.g. (for R Markdown)
         //
         //    ```{r}
         //
         // The $codeBeginPattern determines what begins a chunk for
         // multimode documents.
         else if (/\bcodebegin\b/.test(type))
         {
            chunkCount++;
            var chunkStartPos = position;
            var chunkPos = {row: chunkStartPos.row + 1, column: 0};
            var chunkNum = chunkCount;

            var chunkLabel = getChunkLabel(this.$session, this.$codeBeginPattern, value, iterator);
            var scopeName = "Chunk " + chunkNum;
            if (chunkLabel && value !== "YAML Header")
               scopeName += ": " + chunkLabel;

            this.$scopes.onChunkStart(chunkLabel,
                                         scopeName,
                                         chunkStartPos,
                                         chunkPos);
         }

         // End chunks on 'codeend' type tokens.
         // TODO: Check $codeEndPattern?
         else if (/\bcodeend\b/.test(type))
         {
            position.column += value.length;
            this.$scopes.onChunkEnd(position);
         }

         // Open braces create scopes. A lot of logic is within to
         // determine the 'type' of brace -- e.g. is it associated
         // with a function definition, or just it's own code block?
         // And so on.
         else if (isInRMode && value === "{")
         {
            // Within here, since we know that we're dealing with R code, we
            // can fall back to using the R token cursor.
            var tokenCursor = this.getTokenCursor();
            tokenCursor.moveToPosition(position, true);
            var localCursor = tokenCursor.cloneCursor();

            var startPos;
            if (findAssocFuncToken(localCursor))
            {
               var argsCursor = localCursor.cloneCursor();
               argsCursor.moveToNextToken();

               var functionName = null;
               if (moveFromFunctionTokenToEndOfFunctionName(localCursor))
               {
                  var functionEndCursor = localCursor.cloneCursor();
                  var functionStartCursor = localCursor.cloneCursor();
                  if (functionStartCursor.findStartOfEvaluationContext())
                  {
                     var functionStartPos = functionStartCursor.currentPosition();
                     var functionEndPos   = functionEndCursor.currentPosition();

                     // Only include text on the same line. This avoids cases
                     // where e.g. someone might write
                     //
                     //     env$|
                     //
                     //     # This is a function
                     //     foo <- function(x) { ... }
                     //
                     // It's more likely that the user was just typing a new
                     // statement above than adding on to that function definition;
                     // we should be conservative in looking backwards over comments
                     // when providing that scope.
                     if (functionStartPos.row !== functionEndPos.row) {
                        functionStartPos.row = functionEndPos.row;
                        functionStartPos.column = 0;
                        localCursor.$row = functionStartPos.row;
                        localCursor.$offset = 0;
                     } else {
                        localCursor.moveToPosition(functionStartPos, true);
                     }

                     functionName = this.$doc.getTextRange(new Range(
                        functionStartPos.row,
                        functionStartPos.column,
                        functionEndPos.row,
                        functionEndPos.column + functionEndCursor.currentValue().length
                     ));
                  }
               }

               startPos = localCursor.currentPosition();
               if (localCursor.isFirstSignificantTokenOnLine())
                  startPos.column = 0;

               // Obtain the function arguments by walking through the tokens
               var functionArgs = $getFunctionArgs(argsCursor);
               var functionArgsString = "(" + functionArgs.join(", ") + ")";

               var functionLabel;
               if (functionName == null)
                  functionLabel = $normalizeWhitespace("<function>" + functionArgsString);
               else
                  functionLabel = $normalizeWhitespace(functionName + functionArgsString);

               this.$scopes.onFunctionScopeStart(functionLabel,
                                                 startPos,
                                                 tokenCursor.currentPosition(),
                                                 functionName,
                                                 functionArgs);
            }
            else if (findAssocTestToken(localCursor))
            {
               var descCursor = localCursor.cloneCursor();
               descCursor.moveToPreviousToken();
               descCursor.moveToPreviousToken();

               var desc = descCursor.currentToken().value;

               var testthatCursor = descCursor.cloneCursor();
               testthatCursor.moveToPreviousToken();
               testthatCursor.moveToPreviousToken();

               this.$scopes.onTestScopeStart(desc,
                  testthatCursor.currentPosition(),
                  tokenCursor.currentPosition()
               );
            }
            else
            {
               startPos = tokenCursor.currentPosition();
               if (tokenCursor.isFirstSignificantTokenOnLine())
                  startPos.column = 0;
               this.$scopes.onScopeStart(startPos);
            }
         }

         // A closing brace will close a scope.
         else if (isInRMode && value === "}")
         {
            // Ensure that the closing '}' is treated as part of the scope
            position.column += 1;

            this.$scopes.onScopeEnd(position);
         }

      } while ((token = iterator.moveToNextToken()));

      // Update the current parse position. We want to set this just
      // after the current token; in practice, since the tokenization
      // happens row-wise this means setting the parse position at the
      // start of the next row.
      var rowTokenizedUpTo = Math.max(maxRow, iterator.$row);
      this.$scopes.parsePos = {
         row: rowTokenizedUpTo, column: -1
      };

      return rowTokenizedUpTo;
   };

   this.$getFoldToken = function(session, foldStyle, row) {
      this.$tokenizeUpToRow(row);

      if (this.$statePattern && !this.$statePattern.test(this.$endStates[row]))
          return "";

      var rowTokens = this.$tokens[row];

      for (var i = 0; i < rowTokens.length; i++)
         if (/\bsectionhead\b/.test(rowTokens[i].type))
            return rowTokens[i];

      var depth = 0;
      var unmatchedOpen = null;
      var unmatchedClose = null;

      for (var i = 0; i < rowTokens.length; i++) {
         var token = rowTokens[i];
         if (/\bparen\b/.test(token.type)) {
            switch (token.value) {
               case '{':
                  depth++;
                  if (depth == 1) {
                     unmatchedOpen = token;
                  }
                  break;
               case '}':
                  depth--;
                  if (depth == 0) {
                     unmatchedOpen = null;
                  }
                  if (depth < 0) {
                     unmatchedClose = token;
                     depth = 0;
                  }
                  break;
            }
         }
      }

      if (unmatchedOpen)
         return unmatchedOpen;

      if (foldStyle == "markbeginend" && unmatchedClose)
         return unmatchedClose;

      if (rowTokens.length >= 1) {
         if (/\bcodebegin\b/.test(rowTokens[0].type))
            return rowTokens[0];
         else if (/\bcodeend\b/.test(rowTokens[0].type))
            return rowTokens[0];
      }

      return null;
   };

   this.getFoldWidget = function(session, foldStyle, row) {

      var foldToken = this.$getFoldToken(session, foldStyle, row);
      if (foldToken == null)
         return "";
      if (foldToken.value == '{')
         return "start";
      else if (foldToken.value == '}')
         return "end";
      else if (/\bcodebegin\b/.test(foldToken.type))
         return "start";
      else if (/\bcodeend\b/.test(foldToken.type))
         return "end";
      else if (/\bsectionhead\b/.test(foldToken.type))
         return "start";

      return "";
   };

   this.getFoldWidgetRange = function(session, foldStyle, row) {
      var foldToken = this.$getFoldToken(session, foldStyle, row);
      if (!foldToken)
         return;

      var pos = {row: row, column: foldToken.column + 1};

      if (foldToken.value == '{')
      {
         var end = session.$findClosingBracket(
            foldToken.value,
            pos,
            Utils.getTokenTypeRegex("paren")
         );

         if (!end)
            return;

         return Range.fromPoints(pos, end);
      }
      else if (foldToken.value == '}')
      {

         var start = session.$findOpeningBracket(
            foldToken.value,
            pos,
            Utils.getTokenTypeRegex("paren")
         );

         if (!start)
            return;

         return Range.fromPoints(
            {row: start.row, column: start.column + 1},
            {row: pos.row, column: pos.column - 1}
         );
      }
      else if (/\bcodebegin\b/.test(foldToken.type))
      {
         // Find next codebegin or codeend
         var tokenIterator = new TokenIterator(session, row, 0);
         for (var tok; tok = tokenIterator.stepForward(); ) {
            if (/\bcode(begin|end)\b/.test(tok.type)) {
               var begin = /\bcodebegin\b/.test(tok.type);
               var tokRow = tokenIterator.getCurrentTokenRow();
               var endPos = begin
                     ? {row: tokRow-1, column: session.getLine(tokRow-1).length}
                     : {row: tokRow, column: session.getLine(tokRow).length};
               return Range.fromPoints(
                     {row: row, column: foldToken.column + foldToken.value.length},
                     endPos);
            }
         }
         return;
      }
      else if (/\bcodeend\b/.test(foldToken.type)) {
         var tokenIterator2 = new TokenIterator(session, row, 0);
         for (var tok2; tok2 = tokenIterator2.stepBackward(); ) {
            if (/\bcodebegin\b/.test(tok2.type)) {
               var tokRow2 = tokenIterator2.getCurrentTokenRow();
               return Range.fromPoints(
                     {row: tokRow2, column: session.getLine(tokRow2).length},
                     {row: row, column: session.getLine(row).length});
            }
         }
         return;
      }
      else if (/\bsectionhead\b/.test(foldToken.type)) {

         // Find the position of the section 'tail'.
         var line = session.getLine(row);

         // For unnamed sections, use the end of the line.
         // Otherwise, consume the '----' tail of the section
         // header as well.
         var index;
         if (/^\s*[#=-]+\s*$/.test(line)) {
            index = line.length;
         } else {
            var match = /[#=-]+\s*$/.exec(line);
            if (!match)
               return;
            index = match.index;
         }

         // Use this index as the column for our opening fold.
         pos.column = index;

         // Use a token iterator and find the next section head.
         // We fold up to that section head.
         var it = new TokenIterator(session, row + 1);

         // This has the effect of ensuring that the next call to
         // 'stepForward()' places the iterator on the first token
         // on this row.
         it.$tokenIndex = -1;

         while (token = it.stepForward())
         {
            // Check to see if we've found something that can close
            // our section head. If so, we're done.
             if (token.value === "}" ||
                /\bsectionhead\b/.test(token.type) ||
                /\bcode(?:begin|end)/.test(token.type))
             {
                break;
             }

             // Walk over matching braces -- this allows us to
             // e.g. skip function definitions (and hence, any
             // sub-sections within those functions).
             if (token.value === "{" && it.fwdToMatchingToken())
                continue;
         }

         // If we discovered another section head, we fold up to
         // the previous row; otherwise, we fold the whole document.
         var row = it.getCurrentTokenRow();
         if (token)
            row--;

         var startPos = pos;
         var endPos = {
            row: row,
            column: session.getLine(row).length
         };

         return Range.fromPoints(startPos, endPos);
      }

      return;
   };

   this.getCurrentScope = function(position, filter)
   {
      if (!filter)
         filter = function(scope) { return true; };

      if (!position)
         return "";

      this.$buildScopeTreeUpToRow(position.row);

      var scopePath = this.$scopes.getActiveScopes(position);
      if (scopePath)
      {
         for (var i = scopePath.length-1; i >= 0; i--) {
            if (filter(scopePath[i]))
               return scopePath[i];
         }
      }

      return null;
   };

   this.getScopeTree = function()
   {
      this.$buildScopeTreeUpToRow(this.$doc.getLength() - 1);
      return this.$scopes.getScopeList();
   };

   this.findFunctionDefinitionFromUsage = function(usagePos, functionName)
   {
      this.$buildScopeTreeUpToRow(this.$doc.getLength() - 1);
      return this.$scopes.findFunctionDefinitionFromUsage(usagePos,
                                                          functionName);
   };

   this.getIndentForOpenBrace = function(pos)
   {
      if (this.$tokenizeUpToRow(pos.row))
      {
         var tokenCursor = this.getTokenCursor();
         if (tokenCursor.seekToNearestToken(pos, pos.row)
                   && tokenCursor.currentValue() == "{"
               && tokenCursor.moveBackwardOverMatchingParens())
         {
            return this.$getIndent(this.$getLine(tokenCursor.currentPosition().row));
         }
      }

      return this.$getIndent(this.$getLine(pos.row));
   };

   this.getIndentForRow = function(row)
   {
      return this.getNextLineIndent(
         "start",
         this.$getLine(row),
         this.$session.getTabString(),
         row
      );
   };

   function isOperatorType(type)
   {
      return type === "keyword.operator" ||
             type === "keyword.operator.infix";
   }

   // NOTE: 'row' is an optional parameter, and is not used by default
   // on enter keypresses. When unset, we attempt to indent based on
   // the cursor position (which is what we want for 'enter'
   // keypresses).  However, for reindentation of particular lines (or
   // blocks), we need the row parameter in order to choose which row
   // we wish to reindent.
   this.getNextLineIndent = function(state, line, tab, row)
   {
      // If we're within a multi-line string, preserve the indent
      // of the current line.
      if (Utils.endsWith(state, "qstring"))
         return this.$getIndent(line);

      // NOTE: Pressing enter will already have moved the cursor to
      // the next row, so we need to push that back a single row.
      if (typeof row !== "number")
         row = this.$session.getSelection().getCursor().row - 1;

      var tabSize = this.$session.getTabSize();
      var tabAsSpaces = new Array(tabSize + 1).join(" ");

      // This lineOverrides nonsense is necessary because the line has not
      // changed in the real document yet. We need to simulate it by replacing
      // the real line with the `line` param, and when we finish with this
      // method, undo the damage and invalidate the row.
      // To repro the problem without using lineOverrides, comment out this
      // block of code, and in the editor hit Enter in the middle of a line
      // that contains a }.
      this.$lineOverrides = null;
      if (!(this.$doc.getLine(row) === line))
      {
         this.$lineOverrides = {};
         this.$lineOverrides[row] = line;
         this.$invalidateRow(row);
      }

      try
      {
         var defaultIndent = row < 0 ?
                "" :
                this.$getIndent(this.$getLine(row));

         // jcheng 12/7/2013: It doesn't look to me like $tokenizeUpToRow can return
         // anything but true, at least not today.
         if (!this.$tokenizeUpToRow(row))
            return defaultIndent;

         // The significant token (no whitespace, comments) that most immediately
         // precedes this line. We don't look back further than 10 rows or so for
         // performance reasons.
         var startPos = {
            row: row,
            column: this.$getLine(row).length
         };

         var prevToken = this.$findPreviousSignificantToken(startPos, 0);

         // Special case for new function definitions.
         var line = this.$session.getLine(row);
         if (/\bfunction\s*\(\s*$/.test(line)) {
            return this.$getIndent(row) + tab + tab;
         }

         // Used to add extra whitspace if the next line is a continuation of the
         // previous line (i.e. the last significant token is a binary operator).
         var continuationIndent = "";
         var startedOnOperator = false;

         if (prevToken && isOperatorType(prevToken.token.type))
         {
            // Fix issue 2579: If the previous significant token is an operator
            // (commonly, "+" when used with ggplot) then this line is a
            // continuation of an expression that was started on a previous
            // line. This line's indent should then be whatever would normally
            // be used for a complete statement starting here, plus a tab.
            continuationIndent = tab;
            startedOnOperator = true;
         }

         else if (prevToken
               && /\bparen\b/.test(prevToken.token.type)
               && /\)$/.test(prevToken.token.value))
         {
            // The previous token was a close-paren ")". Check if this is an
            // if/while/for/function without braces, in which case we need to
            // take the indentation of the keyword and indent by one level.
            //
            // Example:
            // if (identical(foo, 1) &&
            //     isTRUE(bar) &&
            //     (!is.null(baz) && !is.na(baz)))
            //   |
            var openParenPos = this.$walkParensBalanced(
                  prevToken.row,
                  prevToken.row - 10,
                  null,
                  function(parens, paren, pos)
                  {
                     return parens.length === 0;
                  });

            if (openParenPos != null)
            {
               var preParenToken = this.$findPreviousSignificantToken(openParenPos, 0);
               if (preParenToken && preParenToken.token.type === "keyword"
                     && /^(if|while|for|function)$/.test(preParenToken.token.value))
               {
                  return this.$getIndent(this.$getLine(preParenToken.row)) + tab;
               }
            }
         }

         else if (prevToken
                     && prevToken.token.type === "keyword"
                     && (prevToken.token.value === "repeat" || prevToken.token.value === "else"))
         {
            // Check if this is a "repeat" or (more commonly) "else" without
            // braces, in which case we need to take the indent of the else/repeat
            // and increase by one level.
            return this.$getIndent(this.$getLine(prevToken.row)) + tab;
         }

         // Walk backwards looking for an open paren, square bracket, curly
         // brace, or assignment token. We use the first found token to provide
         // context for the indentation.
         var tokenCursor = this.getTokenCursor();

         // moveToPosition can fail if there are no tokens previous to
         // the cursor
         if (!tokenCursor.moveToPosition(startPos))
            return "";

         // The first loop looks for an open brace for indentation.
         do
         {
            // If we hit a chunk start/end, just use the same indentation.
            var currentType = tokenCursor.currentType();
            if (currentType === "support.function.codebegin" ||
                currentType === "support.function.codeend")
            {
               return this.$getIndent(
                  this.$doc.getLine(tokenCursor.$row)
               ) + continuationIndent;
            }

            var currentValue = tokenCursor.currentValue();

            if (tokenCursor.isAtStartOfNewExpression(false))
            {
               if (currentValue === "{" ||
                   currentValue === "[" ||
                   currentValue === "(")
               {
                  continuationIndent += tab;
               }

               return this.$getIndent(
                  this.$doc.getLine(tokenCursor.$row)
               ) + continuationIndent;
            }

            if (currentValue === "(" &&
                tokenCursor.isAtStartOfNewExpression(true))
            {
               return this.$getIndent(
                  this.$doc.getLine(tokenCursor.$row)
               ) + tab;
            }

            // Walk over matching braces ('()', '{}', '[]')
            if (tokenCursor.bwdToMatchingToken())
               continue;

            // If we found a '{', we break out and loop back -- this is because
            // we may want to indent either on a '<-' token or on a '{'
            // token.
            if (currentValue === "{")
               break;

            // If we find an open parenthesis or bracket, we
            // can use this to provide the indentation context.
            if (contains(["[", "("], currentValue))
            {
               var openBracePos = tokenCursor.currentPosition();
               var nextTokenPos = null;

               if ($verticallyAlignFunctionArgs) {
                  // If the user has selected
                  // verticallyAlignFunctionArgs mode in the prefs,
                  // for example:
                  //
                  // soDomethingAwesome(a = 1,
                  //                    b = 2,
                  //                    c = 3)
                  //
                  // Then we simply follow the example of the next significant
                  // token. BTW implies that this mode also supports this:
                  //
                  // soDomethingAwesome(
                  //   a = 1,
                  //   b = 2,
                  //   c = 3)
                  //
                  // But not this:
                  //
                  // soDomethingAwesome(a = 1,
                  //   b = 2,
                  //   c = 3)
                  nextTokenPos = this.$findNextSignificantToken(
                     {
                        row: openBracePos.row,
                        column: openBracePos.column + 1
                     }, row);
               }

               if (!nextTokenPos)
               {
                  // Either there wasn't a significant token between the new
                  // line and the previous open brace, or, we're not in
                  // vertical argument alignment mode. Either way, we need
                  // to just indent one level from the open brace's level.
                  return this.getIndentForOpenBrace(openBracePos) +
                     tab + continuationIndent;
               }
               else
               {
                  // Return indent up to next token position.
                  // Note that in hard tab mode, the tab character only counts
                  // as a single character unfortunately. What we really want
                  // is the screen column, but what we have is the document
                  // column, which we can't convert to screen column without
                  // copy-and-pasting a bunch of code from layer/text.js.
                  // As a shortcut, we just pull off the leading whitespace
                  // from the line and include it verbatim in the new indent.
                  // This strategy works fine unless there is a tab in the
                  // line that comes after a non-whitespace character, which
                  // seems like it should be rare.
                  var line = this.$getLine(nextTokenPos.row);
                  var leadingIndent = line.replace(/[^\s].*$/, '');

                  var indentWidth = nextTokenPos.column - leadingIndent.length;
                  var tabsToUse = Math.floor(indentWidth / tabSize);
                  var spacesToAdd = indentWidth - (tabSize * tabsToUse);
                  var buffer = "";
                  for (var i = 0; i < tabsToUse; i++)
                     buffer += tab;
                  for (var j = 0; j < spacesToAdd; j++)
                     buffer += " ";
                  var result = leadingIndent + buffer;

                  // Compute the size of the indent in spaces (e.g. if a tab
                  // is 4 spaces, and result is "\t\t ", the size is 9)
                  var resultSize = result.replace("\t", tabAsSpaces).length;

                  // Sometimes even though verticallyAlignFunctionArgs is used,
                  // the user chooses to manually "break the rules" and use the
                  // non-aligned style, like so:
                  //
                  // plot(foo,
                  //   bar, baz,
                  //
                  // Without the below loop, hitting Enter after "baz," causes
                  // the cursor to end up aligned with foo. The loop simply
                  // replaces the indentation with the minimal indentation.
                  //
                  // TODO: Perhaps we can skip the above few lines of code if
                  // there are other lines present
                  var thisIndent;
                  for (var i = nextTokenPos.row + 1; i <= row; i++) {
                     // If a line contains only whitespace, it doesn't count
                     if (!/[^\s]/.test(this.$getLine(i)))
                        continue;
                     // If this line is is a continuation of a multi-line string,
                     // ignore it.
                     var rowEndState = this.$endStates[i - 1];
                     if (rowEndState === "qstring" || rowEndState === "qqstring")
                        continue;
                     thisIndent = this.$getLine(i).replace(/[^\s].*$/, '');
                     var thisIndentSize = thisIndent.replace("\t", tabAsSpaces).length;
                     if (thisIndentSize < resultSize) {
                        result = thisIndent;
                        resultSize = thisIndentSize;
                     }
                  }

                  // We want to tweak vertical alignment; e.g. in this
                  // case:
                  //
                  //    if (foo &&
                  //        |
                  //
                  // vs.
                  //
                  //    plot(x +
                  //             |
                  //
                  // Ie, normally, we might want a continuation indent if
                  // the line ended with an operator; however, in some
                  // cases (notably with multi-line if statements) we
                  // would prefer not including that indentation.
                  if (isWithinControlFlowArgList(tokenCursor))
                     return result;
                  else
                     return result + continuationIndent;

               }

            }

         } while (tokenCursor.moveToPreviousToken());

         // If we got here, either the scope is provided by a '{'
         // or we failed otherwise. For '{' scopes, we may want to
         // short-circuit and indent based on a '<-', hence the second
         // pass through here.
         if (!tokenCursor.moveToPosition(startPos))
            return "";

         do
         {
            // Walk over matching parens.
            if (tokenCursor.bwdToMatchingToken())
               continue;

            // If we find an open brace, use its associated indentation
            // plus a tab.
            if (tokenCursor.currentValue() === "{")
            {
               return this.getIndentForOpenBrace(
                  tokenCursor.currentPosition()
               ) + tab + continuationIndent;
            }

            // If we found an assignment token, use that for indentation
            if (pAssign(tokenCursor.currentToken()))
            {
               while (pAssign(tokenCursor.currentToken()))
               {
                  // Move off of the assignment token
                  if (!tokenCursor.moveToPreviousToken())
                     break;

                  if (!tokenCursor.findStartOfEvaluationContext())
                     break;

                  // Make sure this isn't the only assignment within a 'naked'
                  // control flow section
                  //
                  //    if (foo)
                  //        x <- 1
                  //
                  // In such cases, we rely on the 'naked' control identifier
                  // to provide the appropriate indentation.
                  var clone = tokenCursor.cloneCursor();
                  if (clone.moveToPreviousToken())
                  {
                     if (clone.currentValue() === "else" ||
                         clone.currentValue() === "repeat")
                     {
                        return this.$getIndent(
                           this.$doc.getLine(clone.$row)
                        ) + continuationIndent + continuationIndent;
                     }

                     var tokenIsClosingParen = clone.currentValue() === ")";
                     if (tokenIsClosingParen &&
                         clone.bwdToMatchingToken() &&
                         clone.moveToPreviousToken())
                     {
                        if (isControlFlowFunctionKeyword(clone.currentValue()))
                        {
                           var line = this.$doc.getLine(clone.$row);

                           // Look beyond nested control flow statements,
                           // to handle cases like:
                           //
                           //    if (foo)
                           //      if (bar)
                           //        x <- 1
                           //    |
                           //
                           if (!startedOnOperator)
                           {
                              while (clone.moveToPreviousToken() &&
                                     clone.currentValue() === ")" &&
                                     clone.bwdToMatchingToken() &&
                                     clone.moveToPreviousToken() &&
                                     isControlFlowFunctionKeyword(clone.currentValue()))
                              {
                                 line = this.$doc.getLine(clone.$row);
                              }
                           }

                           return this.$getIndent(line) + continuationIndent + continuationIndent;
                        }
                     }
                  }

                  // If the previous token is an assignment operator,
                  // move on to it
                  if (pAssign(tokenCursor.peekBwd().currentToken()))
                     tokenCursor.moveToPreviousToken();

               }

               // We broke out of the loop; we should be on the
               // appropriate line to provide for indentation now.
               return this.$getIndent(
                  this.$getLine(tokenCursor.$row)
               ) + continuationIndent;
            }

         } while (tokenCursor.moveToPreviousToken());

         // Fix some edge-case indentation issues, mainly for naked
         // 'if' and 'else' blocks.
         if (startedOnOperator)
         {
            var maxTokensToWalk = 20;
            var count = 0;

            tokenCursor = this.getTokenCursor();
            tokenCursor.moveToPosition(startPos);

            // Move off of the operator
            tokenCursor.moveToPreviousToken();

            do
            {
               // If we encounter an 'if' or 'else' statement, add to
               // the continuation indent
               if (isOneOf(tokenCursor.currentValue(), ["if", "else"]))
               {
                  continuationIndent += tab;
                  break;
               }

               // If we're on a constant, then we need to find an
               // operator beforehand, or give up.
               if (tokenCursor.hasType("constant", "identifier"))
               {

                  if (!tokenCursor.moveToPreviousToken())
                     break;

                  // Check if we're already on an if / else
                  if (isOneOf(tokenCursor.currentValue(), ["if", "else"]))
                  {
                     continuationIndent += tab;
                     break;
                  }

                  // If we're on a ')', check if it's associated with an 'if'
                  if (tokenCursor.currentValue() === ")")
                  {
                     if (!tokenCursor.bwdToMatchingToken())
                        break;

                     if (!tokenCursor.moveToPreviousToken())
                        break;

                     if (isOneOf(tokenCursor.currentValue(), ["if", "else"]))
                     {
                        continuationIndent += tab;
                        break;
                     }

                  }

                  if (!tokenCursor.hasType("operator"))
                     break;

                  continue;
               }

               // Move over a generic 'evaluation', e.g.
               // foo::bar()[1]
               if (!tokenCursor.findStartOfEvaluationContext())
                  break;

            } while (tokenCursor.moveToPreviousToken() &&
                     count++ < maxTokensToWalk);
         }

         // All else fails -- just indent based on the first token.
         var firstToken = this.$findNextSignificantToken(
            {row: 0, column: 0},
            row
         );

         if (firstToken)
            return this.$getIndent(
               this.$getLine(firstToken.row)
            ) + continuationIndent;
         else
            return "" + continuationIndent;
      }
      finally
      {
         if (this.$lineOverrides)
         {
            this.$lineOverrides = null;
            this.$invalidateRow(row);
         }
      }
   };

   this.getBraceIndent = function(row)
   {
      var tokenCursor = this.getTokenCursor();
      var pos = {
         row: row,
         column: this.$getLine(row).length
      };

      if (!tokenCursor.moveToPosition(pos))
         return "";

      if (tokenCursor.currentValue() === ")")
      {
         if (tokenCursor.bwdToMatchingToken() &&
             tokenCursor.moveToPreviousToken())
         {
            var preParenValue = tokenCursor.currentValue();
            if (isOneOf(preParenValue, ["if", "while", "for", "function"]))
            {
               return this.$getIndent(this.$getLine(tokenCursor.$row));
            }
         }
      }
      else if (isOneOf(tokenCursor.currentValue(), ["else", "repeat"]))
      {
         return this.$getIndent(this.$getLine(tokenCursor.$row));
      }

      return this.getIndentForRow(row);
   };

   /**
    * If headInclusive, then a token will match if it starts at pos.
    * If tailInclusive, then a token will match if it ends at pos (meaning
    *    token.column + token.length == pos.column, and token.row == pos.row
    * In all cases, a token will match if pos is after the head and before the
    *    tail.
    *
    * If no token is found, null is returned.
    *
    * Note that whitespace and comment tokens will never be returned.
    */
   this.getTokenForPos = function(pos, headInclusive, tailInclusive)
   {
      this.$tokenizeUpToRow(pos.row);

      if (this.$tokens.length <= pos.row)
         return null;
      var tokens = this.$tokens[pos.row];
      for (var i = 0; i < tokens.length; i++)
      {
         var token = tokens[i];

         if (headInclusive && pos.column == token.column)
            return token;
         if (pos.column <= token.column)
            return null;

         if (tailInclusive && pos.column == token.column + token.value.length)
            return token;
         if (pos.column < token.column + token.value.length)
            return token;
      }
      return null;
   };

   this.$tokenizeUpToRow = function(lastRow)
   {
      // Don't let lastRow be past the end of the document
      lastRow = Math.min(lastRow, this.$endStates.length - 1);

      var row = 0;
      var assumeGood = true;
      for ( ; row <= lastRow; row++)
      {
         // No need to tokenize rows until we hit one that has been explicitly
         // invalidated.
         if (assumeGood && this.$endStates[row])
            continue;

         assumeGood = false;

         var state = (row === 0) ? 'start' : this.$endStates[row - 1];
         var context = Object.assign({}, this.$contexts[row - 1]);
         var line = this.$getLine(row);
         var lineTokens = this.$tokenizer.getLineTokens(line, state, row, context || {});
         this.$contexts[row] = context;

         if (!this.$statePattern ||
             this.$statePattern.test(lineTokens.state) ||
             this.$statePattern.test(state))
            this.$tokens[row] = this.$filterWhitespaceAndComments(lineTokens.tokens);
         else
            this.$tokens[row] = [];

         // If we ended in the same state that the cache says, then we know that
         // the cache is up-to-date for the subsequent lines--UNTIL we hit a row
         // that has been explicitly invalidated.
         if (lineTokens.state === this.$endStates[row])
            assumeGood = true;
         else
            this.$endStates[row] = lineTokens.state;
      }

      if (!assumeGood)
      {
         // If we get here, it means the last row we saw before we exited
         // was invalidated or impacted by an invalidated row. We need to
         // make sure the NEXT row doesn't get ignored next time the tokenizer
         // makes a pass.
         if (row < this.$tokens.length)
            this.$invalidateRow(row);
      }

      return true;
   };

   this.$onDocChange = function(evt)
   {
      if (evt.action === "insert")
         this.$insertNewRows(evt.start.row, evt.end.row - evt.start.row);
      else
         this.$removeRows(evt.start.row, evt.end.row - evt.start.row);

      this.$invalidateRow(evt.start.row);
      this.$scopes.invalidateFrom(evt.start);
   };

   this.$invalidateRow = function(row)
   {
      this.$tokens[row] = null;
      this.$endStates[row] = null;
      this.$contexts[row] = null;
   };

   this.$insertNewRows = function(row, count)
   {
      var args = [row, 0];
      for (var i = 0; i < count; i++)
         args.push(null);

      this.$tokens.splice.apply(this.$tokens, args);
      this.$endStates.splice.apply(this.$endStates, args);
      this.$contexts.splice.apply(this.$contexts, args);
   };

   this.$removeRows = function(row, count)
   {
      this.$tokens.splice(row, count);
      this.$endStates.splice(row, count);
      this.$contexts.splice(row, count);
   };

   this.$getIndent = function(line)
   {
      var match = /^([ \t]*)/.exec(line);
      if (!match)
         return ""; // should never happen, but whatever
      else
         return match[1];
   };

   this.$getLine = function(row)
   {
      if (this.$lineOverrides && typeof(this.$lineOverrides[row]) != 'undefined')
         return this.$lineOverrides[row];
      return this.$doc.getLine(row);
   };

   this.$walkParens = function(startRow, endRow, fun)
   {
      var parenRe = /\bparen\b/;

      if (startRow < endRow)  // forward
      {
         return (function() {
            for ( ; startRow <= endRow; startRow++)
            {
               var tokens = this.$tokens[startRow];
               for (var i = 0; i < tokens.length; i++)
               {
                  if (parenRe.test(tokens[i].type))
                  {
                     var value = tokens[i].value;
                     if (!fun(value, {row: startRow, column: tokens[i].column}))
                        return false;
                  }
               }
            }
            return true;
         }).call(this);
      }
      else // backward
      {
         return (function() {
            startRow = Math.max(0, startRow);
            endRow = Math.max(0, endRow);

            for ( ; startRow >= endRow; startRow--)
            {
               var tokens = this.$tokens[startRow];
               for (var i = tokens.length - 1; i >= 0; i--)
               {
                  if (parenRe.test(tokens[i].type))
                  {
                     var value = tokens[i].value;
                     if (!fun(value, {row: startRow, column: tokens[i].column}))
                        return false;
                  }
               }
            }
            return true;
         }).call(this);
      }
   };

   // Walks BACKWARD over matched pairs of parens. Stop and return result
   // when optional function params preMatch or postMatch return true.
   // preMatch is called when a paren is encountered and BEFORE the parens
   // stack is modified. postMatch is called after the parens stack is modified.
   this.$walkParensBalanced = function(startRow, endRow, preMatch, postMatch)
   {
      // The current stack of parens that are in effect.
      var parens = [];
      var result = null;
      var that = this;
      this.$walkParens(startRow, endRow, function(paren, pos)
      {
         if (preMatch && preMatch(parens, paren, pos))
         {
            result = pos;
            return false;
         }

         if (/[\[({]/.test(paren))
         {
            if (parens[parens.length - 1] === that.$complements[paren])
               parens.pop();
            else
               return true;
         }
         else
         {
            parens.push(paren);
         }

         if (postMatch && postMatch(parens, paren, pos))
         {
            result = pos;
            return false;
         }

         return true;
      });

      return result;
   };

   this.$findNextSignificantToken = function(pos, lastRow)
   {
      if (this.$tokens.length == 0)
         return null;
      lastRow = Math.min(lastRow, this.$tokens.length - 1);

      var row = pos.row;
      var col = pos.column;
      for ( ; row <= lastRow; row++)
      {
         var tokens = this.$tokens[row];

         for (var i = 0; i < tokens.length; i++)
         {
            if (tokens[i].column + tokens[i].value.length > col)
            {
               return {
                  token: tokens[i],
                  row: row,
                  column: Math.max(tokens[i].column, col),
                  offset: i
               };
            }
         }

         col = 0; // After the first row, we'll settle for a token anywhere
      }
      return null;
   };

   this.findNextSignificantToken = function(pos)
   {
	   return this.$findNextSignificantToken(pos, this.$tokens.length - 1);
   };

   this.$findPreviousSignificantToken = function(pos, firstRow)
   {
      if (this.$tokens.length === 0)
         return null;
      firstRow = Math.max(0, firstRow);

      var row = Math.min(pos.row, this.$tokens.length - 1);
      for ( ; row >= firstRow; row--)
      {
         var tokens = this.$tokens[row];
         if (tokens.length === 0)
            continue;

         if (row != pos.row)
            return {
               row: row,
               column: tokens[tokens.length - 1].column,
               token: tokens[tokens.length - 1],
               offset: tokens.length - 1
            };

         for (var i = tokens.length - 1; i >= 0; i--)
         {
            if (tokens[i].column < pos.column)
            {
               return {
                  row: row,
                  column: tokens[i].column,
                  token: tokens[i],
                  offset: i
               };
            }
         }
      }
   };

   function isWhitespaceOrComment(token)
   {
      // virtual-comment is for roxygen content that needs to be highlighted
      // as TeX, but for the purposes of the code model should be invisible.

      if (/\bcode(?:begin|end)\b/.test(token.type))
         return false;

      if (/\bsectionhead\b/.test(token.type))
         return false;

      return /^\s*$/.test(token.value) ||
             token.type.match(/\b(?:ace_virtual-)?comment\b/);
   }

   this.$filterWhitespaceAndComments = function(tokens)
   {
      tokens = tokens.filter(function (t) {
         return !isWhitespaceOrComment(t);
      });

      for (var i = tokens.length - 1; i >= 0; i--)
      {
         if (tokens[i].value.length > 1 && /\bparen\b/.test(tokens[i].type))
         {
            var token = tokens[i];
            tokens.splice(i, 1);
            for (var j = token.value.length - 1; j >= 0; j--)
            {
               var newToken = {
                  type: token.type,
                  value: token.value.charAt(j),
                  column: token.column + j
               };
               tokens.splice(i, 0, newToken);
            }
         }
      }
      return tokens;
   };

}).call(RCodeModel.prototype);

exports.RCodeModel = RCodeModel;

exports.setVerticallyAlignFunctionArgs = function(verticallyAlign) {
   $verticallyAlignFunctionArgs = verticallyAlign;
};

exports.getVerticallyAlignFunctionArgs = function() {
   return $verticallyAlignFunctionArgs;
};

});
/*
 * r_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
var $colorFunctionCalls = false;

define("mode/r_highlight_rules", ["require", "exports", "module"], function(require, exports, module)
{
  var Utils = require("mode/utils");

  function include(rules) {
    var result = new Array(rules.length);
    for (var i = 0; i < rules.length; i++) {
      result[i] = {include: rules[i]};
    }
    return result;
  }

  var oop = require("ace/lib/oop");
  var lang = require("ace/lib/lang");
  var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
  var RainbowParenHighlightRules = require("mode/rainbow_paren_highlight_rules").RainbowParenHighlightRules;
  var Utils = require("mode/utils");

  var reLhsBracket = "[[({]";
  var reRhsBracket = "[\\])}]";

  var RoxygenHighlightRules = function()
  {
    var rules = {};

    rules["start"] = [
      {
        // escaped '@' sign
        token : "comment",
        regex : "@@",
        merge : false
      },
      {
        // latex-style keyword
        token : "keyword",
        regex : "\\\\[a-zA-Z0-9]+",
        merge : false
      },
      {
        // roxygen tag accepting a parameter
        token : ["keyword", "comment"],
        regex : "(@(?:export|field|inheritParams|name|param|rdname|slot|template|useDynLib))(\\s+)(?=[a-zA-Z0-9._-])",
        merge : false,
        next  : "rdoc-highlight"
      },
      {
        // generic roxygen tag
        token : "keyword",
        regex : "@(?!@)[^ ]*",
        merge : false
      },
      {
        // markdown link with =
        token : ["paren.keyword.operator", "comment"],
        regex : "(\\[)(=)",
        merge : false,
        next  : "markdown-link"
      },
      {
        // markdown link
        token : "paren.keyword.operator",
        regex : "\\[",
        merge : false,
        next  : "markdown-link"
      },
      {
        // markdown: `code`
        token : ["support.function", "support.function", "support.function"],
        regex : "(`+)(.*?[^`])(\\1)",
        merge : false
      },
      {
        // markdown: __strong__
        token: ["comment", "constant.language.boolean"],
        regex: "(\\s+|^)(__.+?__)\\b",
        merge: false
      },
      {
        // markdown: _emphasis_
        token: ["comment", "constant.language.boolean"],
        regex: "(\\s+|^)(_(?=[^_])(?:(?:\\\\.)|(?:[^_\\\\]))*?_)\\b",
        merge: false
      },
      {
        // markdown: **strong**
        token: ["constant.numeric"],
        regex: "([*][*].+?[*][*])",
        merge: false
      },
      {
        // markdown: *emphasis*
        token: ["constant.numeric"],
        regex: "([*](?=[^*])(?:(?:\\\\.)|(?:[^*\\\\]))*?[*])",
        merge: false
      },
      {
        // highlight brackets
        token : "paren.keyword.operator",
        regex : "(?:" + reLhsBracket + "|" + reRhsBracket + ")",
        merge : false
      },
      {
        defaultToken: "comment"
      }
    ];

    rules["highlight"] = [
      {
        // highlight non-comma tokens
        token : "identifier.support.function",
        regex : "[^ ,]+"
      },
      {
        // don't highlight commas (e.g. @param a,b,c)
        token : "comment",
        regex : ","
      },
      {
        // escape this state and eat whitespace
        token : "comment",
        regex : "\\s*",
        next  : "start"
      }
    ];

    rules["markdown-link"] = [
      {
        // escape when we find a ']'
        token : "paren.keyword.operator",
        regex : "\\]",
        next  : "start"
      },
      {
        // package qualifier: 'pkg::'
        token : ["identifier.support.class", "comment"],
        regex : "([a-zA-Z0-9_.]+)(:{1,3})"
      },
      {
        // quoted function or object
        token : "support.function",
        regex : "`.*?`"
      },
      {
        // non-parens
        token : "support.function",
        regex : "[^{}()[\\]]+"
      },
      {
        // brackets
        token : "paren.keyword.operator",
        regex : "(?:" + reLhsBracket + "|" + reRhsBracket + ")"
      },
      {
        defaultToken: "comment"
      }
    ];


    this.$rules = rules;
    this.normalizeRules();
  };

  oop.inherits(RoxygenHighlightRules, TextHighlightRules);

  var colorStringTokens = function(quote, text, rgb)
  {
    return [
      { type: "string", value: quote },
      { type: "string.color", value: text, bg: rgb},
      { type: "string", value: quote }
    ];
  };

  var RHighlightRules = function()
  {
    // NOTE: The backslash character is an alias for the 'function' symbol,
    // and can be used for defining short-hand functions, e.g.
    //
    //     \(x) x + 1
    //
    // It was introduced with R 4.2.0.
    var keywords = lang.arrayToMap([
      "\\", "function", "if", "else", "in",
      "break", "next", "repeat", "for", "while"
    ]);

    var specialFunctions = lang.arrayToMap([
      "return", "switch", "try", "tryCatch",
      "stop", "warning", "message",
      "require", "library", "attach", "detach",
      "source", "setMethod", "setGeneric", "setGroupGeneric",
      "setClass", "setRefClass", "R6Class", "UseMethod", "NextMethod"
    ]);

    var builtinConstants = lang.arrayToMap([
      "NULL", "NA", "TRUE", "FALSE", "T", "F", "Inf",
      "NaN", "NA_integer_", "NA_real_", "NA_character_",
      "NA_complex_"
    ]);

    /*
      # R code to regenerate:
      cols <- col2rgb(colors())
      cols[] <- sub(" ", "0", sprintf("%2x", col2rgb(colors())))
      cols <- apply(cols, 2, paste, collapse = "")

      cat(
        "var builtInColors = new Map([",
        paste(paste0('  ["', colors(), '", "', cols, '"]'), collapse = ",\n"),
        "]);",
        sep = "\n"
      )
    */
    var builtInColors = new Map([
      ["white", "ffffff"],
      ["aliceblue", "f0f8ff"],
      ["antiquewhite", "faebd7"],
      ["antiquewhite1", "ffefdb"],
      ["antiquewhite2", "eedfcc"],
      ["antiquewhite3", "cdc0b0"],
      ["antiquewhite4", "8b8378"],
      ["aquamarine", "7fffd4"],
      ["aquamarine1", "7fffd4"],
      ["aquamarine2", "76eec6"],
      ["aquamarine3", "66cdaa"],
      ["aquamarine4", "458b74"],
      ["azure", "f0ffff"],
      ["azure1", "f0ffff"],
      ["azure2", "e0eeee"],
      ["azure3", "c1cdcd"],
      ["azure4", "838b8b"],
      ["beige", "f5f5dc"],
      ["bisque", "ffe4c4"],
      ["bisque1", "ffe4c4"],
      ["bisque2", "eed5b7"],
      ["bisque3", "cdb79e"],
      ["bisque4", "8b7d6b"],
      ["black", "000000"],
      ["blanchedalmond", "ffebcd"],
      ["blue", "0000ff"],
      ["blue1", "0000ff"],
      ["blue2", "0000ee"],
      ["blue3", "0000cd"],
      ["blue4", "00008b"],
      ["blueviolet", "8a2be2"],
      ["brown", "a52a2a"],
      ["brown1", "ff4040"],
      ["brown2", "ee3b3b"],
      ["brown3", "cd3333"],
      ["brown4", "8b2323"],
      ["burlywood", "deb887"],
      ["burlywood1", "ffd39b"],
      ["burlywood2", "eec591"],
      ["burlywood3", "cdaa7d"],
      ["burlywood4", "8b7355"],
      ["cadetblue", "5f9ea0"],
      ["cadetblue1", "98f5ff"],
      ["cadetblue2", "8ee5ee"],
      ["cadetblue3", "7ac5cd"],
      ["cadetblue4", "53868b"],
      ["chartreuse", "7fff00"],
      ["chartreuse1", "7fff00"],
      ["chartreuse2", "76ee00"],
      ["chartreuse3", "66cd00"],
      ["chartreuse4", "458b00"],
      ["chocolate", "d2691e"],
      ["chocolate1", "ff7f24"],
      ["chocolate2", "ee7621"],
      ["chocolate3", "cd661d"],
      ["chocolate4", "8b4513"],
      ["coral", "ff7f50"],
      ["coral1", "ff7256"],
      ["coral2", "ee6a50"],
      ["coral3", "cd5b45"],
      ["coral4", "8b3e2f"],
      ["cornflowerblue", "6495ed"],
      ["cornsilk", "fff8dc"],
      ["cornsilk1", "fff8dc"],
      ["cornsilk2", "eee8cd"],
      ["cornsilk3", "cdc8b1"],
      ["cornsilk4", "8b8878"],
      ["cyan", "00ffff"],
      ["cyan1", "00ffff"],
      ["cyan2", "00eeee"],
      ["cyan3", "00cdcd"],
      ["cyan4", "008b8b"],
      ["darkblue", "00008b"],
      ["darkcyan", "008b8b"],
      ["darkgoldenrod", "b8860b"],
      ["darkgoldenrod1", "ffb90f"],
      ["darkgoldenrod2", "eead0e"],
      ["darkgoldenrod3", "cd950c"],
      ["darkgoldenrod4", "8b6508"],
      ["darkgray", "a9a9a9"],
      ["darkgreen", "006400"],
      ["darkgrey", "a9a9a9"],
      ["darkkhaki", "bdb76b"],
      ["darkmagenta", "8b008b"],
      ["darkolivegreen", "556b2f"],
      ["darkolivegreen1", "caff70"],
      ["darkolivegreen2", "bcee68"],
      ["darkolivegreen3", "a2cd5a"],
      ["darkolivegreen4", "6e8b3d"],
      ["darkorange", "ff8c00"],
      ["darkorange1", "ff7f00"],
      ["darkorange2", "ee7600"],
      ["darkorange3", "cd6600"],
      ["darkorange4", "8b4500"],
      ["darkorchid", "9932cc"],
      ["darkorchid1", "bf3eff"],
      ["darkorchid2", "b23aee"],
      ["darkorchid3", "9a32cd"],
      ["darkorchid4", "68228b"],
      ["darkred", "8b0000"],
      ["darksalmon", "e9967a"],
      ["darkseagreen", "8fbc8f"],
      ["darkseagreen1", "c1ffc1"],
      ["darkseagreen2", "b4eeb4"],
      ["darkseagreen3", "9bcd9b"],
      ["darkseagreen4", "698b69"],
      ["darkslateblue", "483d8b"],
      ["darkslategray", "2f4f4f"],
      ["darkslategray1", "97ffff"],
      ["darkslategray2", "8deeee"],
      ["darkslategray3", "79cdcd"],
      ["darkslategray4", "528b8b"],
      ["darkslategrey", "2f4f4f"],
      ["darkturquoise", "00ced1"],
      ["darkviolet", "9400d3"],
      ["deeppink", "ff1493"],
      ["deeppink1", "ff1493"],
      ["deeppink2", "ee1289"],
      ["deeppink3", "cd1076"],
      ["deeppink4", "8b0a50"],
      ["deepskyblue", "00bfff"],
      ["deepskyblue1", "00bfff"],
      ["deepskyblue2", "00b2ee"],
      ["deepskyblue3", "009acd"],
      ["deepskyblue4", "00688b"],
      ["dimgray", "696969"],
      ["dimgrey", "696969"],
      ["dodgerblue", "1e90ff"],
      ["dodgerblue1", "1e90ff"],
      ["dodgerblue2", "1c86ee"],
      ["dodgerblue3", "1874cd"],
      ["dodgerblue4", "104e8b"],
      ["firebrick", "b22222"],
      ["firebrick1", "ff3030"],
      ["firebrick2", "ee2c2c"],
      ["firebrick3", "cd2626"],
      ["firebrick4", "8b1a1a"],
      ["floralwhite", "fffaf0"],
      ["forestgreen", "228b22"],
      ["gainsboro", "dcdcdc"],
      ["ghostwhite", "f8f8ff"],
      ["gold", "ffd700"],
      ["gold1", "ffd700"],
      ["gold2", "eec900"],
      ["gold3", "cdad00"],
      ["gold4", "8b7500"],
      ["goldenrod", "daa520"],
      ["goldenrod1", "ffc125"],
      ["goldenrod2", "eeb422"],
      ["goldenrod3", "cd9b1d"],
      ["goldenrod4", "8b6914"],
      ["gray", "bebebe"],
      ["gray0", "000000"],
      ["gray1", "030303"],
      ["gray2", "050505"],
      ["gray3", "080808"],
      ["gray4", "0a0a0a"],
      ["gray5", "0d0d0d"],
      ["gray6", "0f0f0f"],
      ["gray7", "121212"],
      ["gray8", "141414"],
      ["gray9", "171717"],
      ["gray10", "1a1a1a"],
      ["gray11", "1c1c1c"],
      ["gray12", "1f1f1f"],
      ["gray13", "212121"],
      ["gray14", "242424"],
      ["gray15", "262626"],
      ["gray16", "292929"],
      ["gray17", "2b2b2b"],
      ["gray18", "2e2e2e"],
      ["gray19", "303030"],
      ["gray20", "333333"],
      ["gray21", "363636"],
      ["gray22", "383838"],
      ["gray23", "3b3b3b"],
      ["gray24", "3d3d3d"],
      ["gray25", "404040"],
      ["gray26", "424242"],
      ["gray27", "454545"],
      ["gray28", "474747"],
      ["gray29", "4a4a4a"],
      ["gray30", "4d4d4d"],
      ["gray31", "4f4f4f"],
      ["gray32", "525252"],
      ["gray33", "545454"],
      ["gray34", "575757"],
      ["gray35", "595959"],
      ["gray36", "5c5c5c"],
      ["gray37", "5e5e5e"],
      ["gray38", "616161"],
      ["gray39", "636363"],
      ["gray40", "666666"],
      ["gray41", "696969"],
      ["gray42", "6b6b6b"],
      ["gray43", "6e6e6e"],
      ["gray44", "707070"],
      ["gray45", "737373"],
      ["gray46", "757575"],
      ["gray47", "787878"],
      ["gray48", "7a7a7a"],
      ["gray49", "7d7d7d"],
      ["gray50", "7f7f7f"],
      ["gray51", "828282"],
      ["gray52", "858585"],
      ["gray53", "878787"],
      ["gray54", "8a8a8a"],
      ["gray55", "8c8c8c"],
      ["gray56", "8f8f8f"],
      ["gray57", "919191"],
      ["gray58", "949494"],
      ["gray59", "969696"],
      ["gray60", "999999"],
      ["gray61", "9c9c9c"],
      ["gray62", "9e9e9e"],
      ["gray63", "a1a1a1"],
      ["gray64", "a3a3a3"],
      ["gray65", "a6a6a6"],
      ["gray66", "a8a8a8"],
      ["gray67", "ababab"],
      ["gray68", "adadad"],
      ["gray69", "b0b0b0"],
      ["gray70", "b3b3b3"],
      ["gray71", "b5b5b5"],
      ["gray72", "b8b8b8"],
      ["gray73", "bababa"],
      ["gray74", "bdbdbd"],
      ["gray75", "bfbfbf"],
      ["gray76", "c2c2c2"],
      ["gray77", "c4c4c4"],
      ["gray78", "c7c7c7"],
      ["gray79", "c9c9c9"],
      ["gray80", "cccccc"],
      ["gray81", "cfcfcf"],
      ["gray82", "d1d1d1"],
      ["gray83", "d4d4d4"],
      ["gray84", "d6d6d6"],
      ["gray85", "d9d9d9"],
      ["gray86", "dbdbdb"],
      ["gray87", "dedede"],
      ["gray88", "e0e0e0"],
      ["gray89", "e3e3e3"],
      ["gray90", "e5e5e5"],
      ["gray91", "e8e8e8"],
      ["gray92", "ebebeb"],
      ["gray93", "ededed"],
      ["gray94", "f0f0f0"],
      ["gray95", "f2f2f2"],
      ["gray96", "f5f5f5"],
      ["gray97", "f7f7f7"],
      ["gray98", "fafafa"],
      ["gray99", "fcfcfc"],
      ["gray100", "ffffff"],
      ["green", "00ff00"],
      ["green1", "00ff00"],
      ["green2", "00ee00"],
      ["green3", "00cd00"],
      ["green4", "008b00"],
      ["greenyellow", "adff2f"],
      ["grey", "bebebe"],
      ["grey0", "000000"],
      ["grey1", "030303"],
      ["grey2", "050505"],
      ["grey3", "080808"],
      ["grey4", "0a0a0a"],
      ["grey5", "0d0d0d"],
      ["grey6", "0f0f0f"],
      ["grey7", "121212"],
      ["grey8", "141414"],
      ["grey9", "171717"],
      ["grey10", "1a1a1a"],
      ["grey11", "1c1c1c"],
      ["grey12", "1f1f1f"],
      ["grey13", "212121"],
      ["grey14", "242424"],
      ["grey15", "262626"],
      ["grey16", "292929"],
      ["grey17", "2b2b2b"],
      ["grey18", "2e2e2e"],
      ["grey19", "303030"],
      ["grey20", "333333"],
      ["grey21", "363636"],
      ["grey22", "383838"],
      ["grey23", "3b3b3b"],
      ["grey24", "3d3d3d"],
      ["grey25", "404040"],
      ["grey26", "424242"],
      ["grey27", "454545"],
      ["grey28", "474747"],
      ["grey29", "4a4a4a"],
      ["grey30", "4d4d4d"],
      ["grey31", "4f4f4f"],
      ["grey32", "525252"],
      ["grey33", "545454"],
      ["grey34", "575757"],
      ["grey35", "595959"],
      ["grey36", "5c5c5c"],
      ["grey37", "5e5e5e"],
      ["grey38", "616161"],
      ["grey39", "636363"],
      ["grey40", "666666"],
      ["grey41", "696969"],
      ["grey42", "6b6b6b"],
      ["grey43", "6e6e6e"],
      ["grey44", "707070"],
      ["grey45", "737373"],
      ["grey46", "757575"],
      ["grey47", "787878"],
      ["grey48", "7a7a7a"],
      ["grey49", "7d7d7d"],
      ["grey50", "7f7f7f"],
      ["grey51", "828282"],
      ["grey52", "858585"],
      ["grey53", "878787"],
      ["grey54", "8a8a8a"],
      ["grey55", "8c8c8c"],
      ["grey56", "8f8f8f"],
      ["grey57", "919191"],
      ["grey58", "949494"],
      ["grey59", "969696"],
      ["grey60", "999999"],
      ["grey61", "9c9c9c"],
      ["grey62", "9e9e9e"],
      ["grey63", "a1a1a1"],
      ["grey64", "a3a3a3"],
      ["grey65", "a6a6a6"],
      ["grey66", "a8a8a8"],
      ["grey67", "ababab"],
      ["grey68", "adadad"],
      ["grey69", "b0b0b0"],
      ["grey70", "b3b3b3"],
      ["grey71", "b5b5b5"],
      ["grey72", "b8b8b8"],
      ["grey73", "bababa"],
      ["grey74", "bdbdbd"],
      ["grey75", "bfbfbf"],
      ["grey76", "c2c2c2"],
      ["grey77", "c4c4c4"],
      ["grey78", "c7c7c7"],
      ["grey79", "c9c9c9"],
      ["grey80", "cccccc"],
      ["grey81", "cfcfcf"],
      ["grey82", "d1d1d1"],
      ["grey83", "d4d4d4"],
      ["grey84", "d6d6d6"],
      ["grey85", "d9d9d9"],
      ["grey86", "dbdbdb"],
      ["grey87", "dedede"],
      ["grey88", "e0e0e0"],
      ["grey89", "e3e3e3"],
      ["grey90", "e5e5e5"],
      ["grey91", "e8e8e8"],
      ["grey92", "ebebeb"],
      ["grey93", "ededed"],
      ["grey94", "f0f0f0"],
      ["grey95", "f2f2f2"],
      ["grey96", "f5f5f5"],
      ["grey97", "f7f7f7"],
      ["grey98", "fafafa"],
      ["grey99", "fcfcfc"],
      ["grey100", "ffffff"],
      ["honeydew", "f0fff0"],
      ["honeydew1", "f0fff0"],
      ["honeydew2", "e0eee0"],
      ["honeydew3", "c1cdc1"],
      ["honeydew4", "838b83"],
      ["hotpink", "ff69b4"],
      ["hotpink1", "ff6eb4"],
      ["hotpink2", "ee6aa7"],
      ["hotpink3", "cd6090"],
      ["hotpink4", "8b3a62"],
      ["indianred", "cd5c5c"],
      ["indianred1", "ff6a6a"],
      ["indianred2", "ee6363"],
      ["indianred3", "cd5555"],
      ["indianred4", "8b3a3a"],
      ["ivory", "fffff0"],
      ["ivory1", "fffff0"],
      ["ivory2", "eeeee0"],
      ["ivory3", "cdcdc1"],
      ["ivory4", "8b8b83"],
      ["khaki", "f0e68c"],
      ["khaki1", "fff68f"],
      ["khaki2", "eee685"],
      ["khaki3", "cdc673"],
      ["khaki4", "8b864e"],
      ["lavender", "e6e6fa"],
      ["lavenderblush", "fff0f5"],
      ["lavenderblush1", "fff0f5"],
      ["lavenderblush2", "eee0e5"],
      ["lavenderblush3", "cdc1c5"],
      ["lavenderblush4", "8b8386"],
      ["lawngreen", "7cfc00"],
      ["lemonchiffon", "fffacd"],
      ["lemonchiffon1", "fffacd"],
      ["lemonchiffon2", "eee9bf"],
      ["lemonchiffon3", "cdc9a5"],
      ["lemonchiffon4", "8b8970"],
      ["lightblue", "add8e6"],
      ["lightblue1", "bfefff"],
      ["lightblue2", "b2dfee"],
      ["lightblue3", "9ac0cd"],
      ["lightblue4", "68838b"],
      ["lightcoral", "f08080"],
      ["lightcyan", "e0ffff"],
      ["lightcyan1", "e0ffff"],
      ["lightcyan2", "d1eeee"],
      ["lightcyan3", "b4cdcd"],
      ["lightcyan4", "7a8b8b"],
      ["lightgoldenrod", "eedd82"],
      ["lightgoldenrod1", "ffec8b"],
      ["lightgoldenrod2", "eedc82"],
      ["lightgoldenrod3", "cdbe70"],
      ["lightgoldenrod4", "8b814c"],
      ["lightgoldenrodyellow", "fafad2"],
      ["lightgray", "d3d3d3"],
      ["lightgreen", "90ee90"],
      ["lightgrey", "d3d3d3"],
      ["lightpink", "ffb6c1"],
      ["lightpink1", "ffaeb9"],
      ["lightpink2", "eea2ad"],
      ["lightpink3", "cd8c95"],
      ["lightpink4", "8b5f65"],
      ["lightsalmon", "ffa07a"],
      ["lightsalmon1", "ffa07a"],
      ["lightsalmon2", "ee9572"],
      ["lightsalmon3", "cd8162"],
      ["lightsalmon4", "8b5742"],
      ["lightseagreen", "20b2aa"],
      ["lightskyblue", "87cefa"],
      ["lightskyblue1", "b0e2ff"],
      ["lightskyblue2", "a4d3ee"],
      ["lightskyblue3", "8db6cd"],
      ["lightskyblue4", "607b8b"],
      ["lightslateblue", "8470ff"],
      ["lightslategray", "778899"],
      ["lightslategrey", "778899"],
      ["lightsteelblue", "b0c4de"],
      ["lightsteelblue1", "cae1ff"],
      ["lightsteelblue2", "bcd2ee"],
      ["lightsteelblue3", "a2b5cd"],
      ["lightsteelblue4", "6e7b8b"],
      ["lightyellow", "ffffe0"],
      ["lightyellow1", "ffffe0"],
      ["lightyellow2", "eeeed1"],
      ["lightyellow3", "cdcdb4"],
      ["lightyellow4", "8b8b7a"],
      ["limegreen", "32cd32"],
      ["linen", "faf0e6"],
      ["magenta", "ff00ff"],
      ["magenta1", "ff00ff"],
      ["magenta2", "ee00ee"],
      ["magenta3", "cd00cd"],
      ["magenta4", "8b008b"],
      ["maroon", "b03060"],
      ["maroon1", "ff34b3"],
      ["maroon2", "ee30a7"],
      ["maroon3", "cd2990"],
      ["maroon4", "8b1c62"],
      ["mediumaquamarine", "66cdaa"],
      ["mediumblue", "0000cd"],
      ["mediumorchid", "ba55d3"],
      ["mediumorchid1", "e066ff"],
      ["mediumorchid2", "d15fee"],
      ["mediumorchid3", "b452cd"],
      ["mediumorchid4", "7a378b"],
      ["mediumpurple", "9370db"],
      ["mediumpurple1", "ab82ff"],
      ["mediumpurple2", "9f79ee"],
      ["mediumpurple3", "8968cd"],
      ["mediumpurple4", "5d478b"],
      ["mediumseagreen", "3cb371"],
      ["mediumslateblue", "7b68ee"],
      ["mediumspringgreen", "00fa9a"],
      ["mediumturquoise", "48d1cc"],
      ["mediumvioletred", "c71585"],
      ["midnightblue", "191970"],
      ["mintcream", "f5fffa"],
      ["mistyrose", "ffe4e1"],
      ["mistyrose1", "ffe4e1"],
      ["mistyrose2", "eed5d2"],
      ["mistyrose3", "cdb7b5"],
      ["mistyrose4", "8b7d7b"],
      ["moccasin", "ffe4b5"],
      ["navajowhite", "ffdead"],
      ["navajowhite1", "ffdead"],
      ["navajowhite2", "eecfa1"],
      ["navajowhite3", "cdb38b"],
      ["navajowhite4", "8b795e"],
      ["navy", "000080"],
      ["navyblue", "000080"],
      ["oldlace", "fdf5e6"],
      ["olivedrab", "6b8e23"],
      ["olivedrab1", "c0ff3e"],
      ["olivedrab2", "b3ee3a"],
      ["olivedrab3", "9acd32"],
      ["olivedrab4", "698b22"],
      ["orange", "ffa500"],
      ["orange1", "ffa500"],
      ["orange2", "ee9a00"],
      ["orange3", "cd8500"],
      ["orange4", "8b5a00"],
      ["orangered", "ff4500"],
      ["orangered1", "ff4500"],
      ["orangered2", "ee4000"],
      ["orangered3", "cd3700"],
      ["orangered4", "8b2500"],
      ["orchid", "da70d6"],
      ["orchid1", "ff83fa"],
      ["orchid2", "ee7ae9"],
      ["orchid3", "cd69c9"],
      ["orchid4", "8b4789"],
      ["palegoldenrod", "eee8aa"],
      ["palegreen", "98fb98"],
      ["palegreen1", "9aff9a"],
      ["palegreen2", "90ee90"],
      ["palegreen3", "7ccd7c"],
      ["palegreen4", "548b54"],
      ["paleturquoise", "afeeee"],
      ["paleturquoise1", "bbffff"],
      ["paleturquoise2", "aeeeee"],
      ["paleturquoise3", "96cdcd"],
      ["paleturquoise4", "668b8b"],
      ["palevioletred", "db7093"],
      ["palevioletred1", "ff82ab"],
      ["palevioletred2", "ee799f"],
      ["palevioletred3", "cd6889"],
      ["palevioletred4", "8b475d"],
      ["papayawhip", "ffefd5"],
      ["peachpuff", "ffdab9"],
      ["peachpuff1", "ffdab9"],
      ["peachpuff2", "eecbad"],
      ["peachpuff3", "cdaf95"],
      ["peachpuff4", "8b7765"],
      ["peru", "cd853f"],
      ["pink", "ffc0cb"],
      ["pink1", "ffb5c5"],
      ["pink2", "eea9b8"],
      ["pink3", "cd919e"],
      ["pink4", "8b636c"],
      ["plum", "dda0dd"],
      ["plum1", "ffbbff"],
      ["plum2", "eeaeee"],
      ["plum3", "cd96cd"],
      ["plum4", "8b668b"],
      ["powderblue", "b0e0e6"],
      ["purple", "a020f0"],
      ["purple1", "9b30ff"],
      ["purple2", "912cee"],
      ["purple3", "7d26cd"],
      ["purple4", "551a8b"],
      ["red", "ff0000"],
      ["red1", "ff0000"],
      ["red2", "ee0000"],
      ["red3", "cd0000"],
      ["red4", "8b0000"],
      ["rosybrown", "bc8f8f"],
      ["rosybrown1", "ffc1c1"],
      ["rosybrown2", "eeb4b4"],
      ["rosybrown3", "cd9b9b"],
      ["rosybrown4", "8b6969"],
      ["royalblue", "4169e1"],
      ["royalblue1", "4876ff"],
      ["royalblue2", "436eee"],
      ["royalblue3", "3a5fcd"],
      ["royalblue4", "27408b"],
      ["saddlebrown", "8b4513"],
      ["salmon", "fa8072"],
      ["salmon1", "ff8c69"],
      ["salmon2", "ee8262"],
      ["salmon3", "cd7054"],
      ["salmon4", "8b4c39"],
      ["sandybrown", "f4a460"],
      ["seagreen", "2e8b57"],
      ["seagreen1", "54ff9f"],
      ["seagreen2", "4eee94"],
      ["seagreen3", "43cd80"],
      ["seagreen4", "2e8b57"],
      ["seashell", "fff5ee"],
      ["seashell1", "fff5ee"],
      ["seashell2", "eee5de"],
      ["seashell3", "cdc5bf"],
      ["seashell4", "8b8682"],
      ["sienna", "a0522d"],
      ["sienna1", "ff8247"],
      ["sienna2", "ee7942"],
      ["sienna3", "cd6839"],
      ["sienna4", "8b4726"],
      ["skyblue", "87ceeb"],
      ["skyblue1", "87ceff"],
      ["skyblue2", "7ec0ee"],
      ["skyblue3", "6ca6cd"],
      ["skyblue4", "4a708b"],
      ["slateblue", "6a5acd"],
      ["slateblue1", "836fff"],
      ["slateblue2", "7a67ee"],
      ["slateblue3", "6959cd"],
      ["slateblue4", "473c8b"],
      ["slategray", "708090"],
      ["slategray1", "c6e2ff"],
      ["slategray2", "b9d3ee"],
      ["slategray3", "9fb6cd"],
      ["slategray4", "6c7b8b"],
      ["slategrey", "708090"],
      ["snow", "fffafa"],
      ["snow1", "fffafa"],
      ["snow2", "eee9e9"],
      ["snow3", "cdc9c9"],
      ["snow4", "8b8989"],
      ["springgreen", "00ff7f"],
      ["springgreen1", "00ff7f"],
      ["springgreen2", "00ee76"],
      ["springgreen3", "00cd66"],
      ["springgreen4", "008b45"],
      ["steelblue", "4682b4"],
      ["steelblue1", "63b8ff"],
      ["steelblue2", "5cacee"],
      ["steelblue3", "4f94cd"],
      ["steelblue4", "36648b"],
      ["tan", "d2b48c"],
      ["tan1", "ffa54f"],
      ["tan2", "ee9a49"],
      ["tan3", "cd853f"],
      ["tan4", "8b5a2b"],
      ["thistle", "d8bfd8"],
      ["thistle1", "ffe1ff"],
      ["thistle2", "eed2ee"],
      ["thistle3", "cdb5cd"],
      ["thistle4", "8b7b8b"],
      ["tomato", "ff6347"],
      ["tomato1", "ff6347"],
      ["tomato2", "ee5c42"],
      ["tomato3", "cd4f39"],
      ["tomato4", "8b3626"],
      ["turquoise", "40e0d0"],
      ["turquoise1", "00f5ff"],
      ["turquoise2", "00e5ee"],
      ["turquoise3", "00c5cd"],
      ["turquoise4", "00868b"],
      ["violet", "ee82ee"],
      ["violetred", "d02090"],
      ["violetred1", "ff3e96"],
      ["violetred2", "ee3a8c"],
      ["violetred3", "cd3278"],
      ["violetred4", "8b2252"],
      ["wheat", "f5deb3"],
      ["wheat1", "ffe7ba"],
      ["wheat2", "eed8ae"],
      ["wheat3", "cdba96"],
      ["wheat4", "8b7e66"],
      ["whitesmoke", "f5f5f5"],
      ["yellow", "ffff00"],
      ["yellow1", "ffff00"],
      ["yellow2", "eeee00"],
      ["yellow3", "cdcd00"],
      ["yellow4", "8b8b00"],
      ["yellowgreen", "9acd32"]
    ]);

    // NOTE: We accept '\' as a standalone identifier here
    // so that it can be parsed as the 'function' alias symbol.
    //
    // Unicode escapes are picked to conform with TR31:
    // https://unicode.org/reports/tr31/#Default_Identifier_Syntax
    var reIdentifier = String.raw`(?:\\|_|[\p{L}\p{Nl}.][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}.]*)`;

    var $complements = {
      "{" : "}",
      "[" : "]",
      "(" : ")"
    };

    var rules = {};

    // Define rule sub-blocks that can be included to create
    // full rule states.
    rules["#comment"] = [
      {
        token : "comment.sectionhead",
        regex : "#+(?!').*(?:----|====|####)\\s*$",
        next  : "start"
      },
      {
        // Begin Roxygen with todo
        token : ["comment", "comment.keyword.operator"],
        regex : "(#+['*]\\s*)(TODO|FIXME)\\b",
        next  : "rdoc-start"
      },
      {
        // Roxygen
        token : "comment",
        regex : "#+['*]",
        next  : "rdoc-start"
      },
      {
        // todo in plain comment
        token : ["comment", "comment.keyword.operator", "comment"],
        regex : "(#+\\s*)(TODO|FIXME)\\b(.*)$",
        next  : "start"
      },
      {
        token : "comment",
        regex : "#.*$",
        next  : "start"
      }
    ];

    rules["#string"] = [
      {
        token : "string",
        regex : "[rR]['\"][-]*[[({]",
        next  : "rawstring",
        onMatch: function(value, state, stack, line) {

          // initialize stack
          stack = stack || [];

          // save current state in stack
          stack[0] = state;

          // save the name of the next state
          // (needed because state names can be mutated in multi-mode documents)
          stack[1] = this.next;

          // save the expected suffix for exit
          stack[2] =
            $complements[value[value.length - 1]] +
            value.substring(2, value.length - 1) +
            value[1];

          return this.token;
        }
      },
      {
        token : "string", // hex color #rrggbb or #rrggbbaa
        regex : '(["\'])(#[0-9a-fA-F]{6})([0-9a-fA-F]{2})?(\\1)',
        next  : "start",
        onMatch: function(value, state, stack, line) {
          var quote = value.substring(0,1);
          var col = value.substring(1, value.length - 1);
          return colorStringTokens(quote, col, col);
        }
      },
      {
        token : "string", // hex color #rgb
        regex : '(["\'])(#[0-9a-fA-F]{3})(\\1)',
        next  : "start",
        onMatch: function(value, state, stack, line) {
          var quote = value.substring(0, 1);
          var col = value.substring(1, value.length - 1);
          return colorStringTokens(quote, col, col);
        }
      },
      {
        // strings that *might* be R named colors
        // - first check that they are lower-case letters maybe followed by numbers
        // - then in that case test against the builtInColors map
        token : "string",
        regex : '(["\'])([a-z]+[0-9]*)(\\1)',
        next  : "start",
        onMatch: function(value, state, stack, line) {
          var quote = value.substring(0, 1);
          var content = value.substring(1, value.length - 1);
          var rgb = builtInColors.get(content);
          if (rgb === undefined)
            return this.token;
          else
            return colorStringTokens(quote, content, "#" + rgb);
        }
      },
      {
        token : "string", // single line
        regex : '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]',
        next  : "start"
      },
      {
        token : "string", // single line
        regex : "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']",
        next  : "start"
      },
      {
        token : "string", // multi line string start
        merge : true,
        regex : '["]',
        next : "qqstring"
      },
      {
        token : "string", // multi line string start
        merge : true,
        regex : "[']",
        next : "qstring"
      }
    ];

    rules["#number"] = [
      {
        token : "constant.numeric", // hex
        regex : "0[xX][0-9a-fA-F]+[Li]?",
        merge : false,
        next  : "start"
      },
      {
        token : "constant.numeric", // number + integer
        regex : "(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eE][+-]?\\d*)?[iL]?",
        merge : false,
        next  : "start"
      }
    ];

    rules["#quoted-identifier"] = [
      {
        token : "identifier",
        regex : "[`](?:(?:\\\\.)|(?:[^`\\\\]))*?[`]",
        merge : false,
        next  : "start"
      }
    ];

    rules["#keyword-or-identifier"] = [
      {
        token : function(value)
        {
          if (builtinConstants.hasOwnProperty(value))
            return "constant.language";
          else if (keywords.hasOwnProperty(value))
            return "keyword";
          else if (value.match(/^\.\.\d+$/))
            return "variable.language";
          else
            return "identifier";
        },
        regex   : reIdentifier,
        unicode : true,
        merge   : false,
        next    : "start"
      }
    ];

    rules["#package-access"] = [
      {
        token : function(value) {
          if ($colorFunctionCalls)
            return "identifier.support.class";
          else
            return "identifier";
        },
        regex   : reIdentifier + "(?=\\s*::)",
        unicode : true,
        merge   : false,
        next    : "start"
      }
    ];

    rules["#function-call"] = [
      {
        token : function(value) {
          if ($colorFunctionCalls)
            return "identifier.support.function";
          else
            return "identifier";
        },
        regex   : reIdentifier + "(?=\\s*\\()",
        unicode : true,
        merge   : false,
        next    : "start"
      }
    ];

    rules["#function-call-or-keyword"] = [
      {
        token : function(value) {
          if (specialFunctions.hasOwnProperty(value) || keywords.hasOwnProperty(value))
            return "keyword";
          else if ($colorFunctionCalls)
            return "identifier.support.function";
          else
            return "identifier";
        },
        regex   : reIdentifier + "(?=\\s*\\()",
        unicode : true,
        merge   : false,
        next    : "start"
      }
    ];

    rules["#operator"] = [
      {
        token : "keyword.operator",
        regex : "\\$|@",
        merge : false,
        next  : "afterDollar"
      },
      {
        token : "keyword.operator",
        regex : ":::|::|:=|\\|>|=>|%%|>=|<=|==|!=|<<-|->>|->|<-|\\|\\||&&|=|\\+|-|\\*\\*?|/|\\^|>|<|!|&|\\||~|\\$|:|@|\\?",
        merge : false,
        next  : "start"
      },
      {
        token : "keyword.operator.infix", // infix operators
        regex : "%.*?%",
        merge : false,
        next  : "start"
      },
      RainbowParenHighlightRules.getParenRule(),
      {
        token : function(value) {
          return $colorFunctionCalls ?
            "punctuation.keyword.operator" :
            "punctuation";
        },
        regex : "[;]",
        merge : false,
        next  : "start"
      },
      {
        token : function(value) {
          return $colorFunctionCalls ?
            "punctuation.keyword.operator" :
            "punctuation";
        },
        regex : "[,]",
        merge : false,
        next  : "start"
      }
    ];

    rules["#knitr-embed"] = [
      {
        token: "constant.language",
        regex: "^[<][<][^>]+[>][>]$",
        merge: false
      }
    ];

    rules["#text"] = [
      {
        token : "text",
        regex : "\\s+"
      }
    ];

    // Construct rules from previously defined blocks.
    rules["start"] = include([
      "#comment", "#string", "#number",
      "#package-access", "#quoted-identifier",
      "#function-call-or-keyword", "#keyword-or-identifier",
      "#knitr-embed", "#operator", "#text"
    ]);

    rules["afterDollar"] = include([
      "#comment", "#string", "#number",
      "#quoted-identifier",
      "#function-call", "#keyword-or-identifier",
      "#operator", "#text"
    ]);

    rules["rawstring"] = [

      // attempt to match the end of the raw string. be permissive
      // in what the regular expression matches, but validate that
      // the matched string is indeed the expected suffix based on
      // what was provided when we entered the 'rawstring' state
      {
        token : "string",
        regex : "[\\]})][-]*['\"]",
        onMatch: function(value, state, stack, line) {
          this.next = (value === stack[2]) ? stack[0] : stack[1];
          return this.token;
        }
      },

      {
        defaultToken : "string"
      }
    ];

    rules["qqstring"] = [
      {
        token : "string",
        regex : '(?:(?:\\\\.)|(?:[^"\\\\]))*?"',
        next  : "start"
      },
      {
        token : "string",
        regex : ".+",
        merge : true
      }
    ];

    rules["qstring"] = [
      {
        token : "string",
        regex : "(?:(?:\\\\.)|(?:[^'\\\\]))*?'",
        next  : "start"
      },
      {
        token : "string",
        regex : ".+",
        merge : true
      }
    ];

    this.$rules = rules;

    // Embed Roxygen highlight Roxygen highlight rules
    var rdRules = new RoxygenHighlightRules().getRules();

    // Add 'virtual-comment' to embedded rules
    for (var state in rdRules) {
      var rules = rdRules[state];
      for (var i = 0; i < rules.length; i++) {
        if (Utils.isArray(rules[i].token)) {
          for (var j = 0; j < rules[i].token.length; j++)
            rules[i].token[j] += ".virtual-comment";
        } else {
          rules[i].token += ".virtual-comment";
        }
      }
    }

    this.embedRules(rdRules, "rdoc-", [{
      token : "text",
      regex : "^",
      next  : "start"
    }]);

    Utils.embedQuartoHighlightRules(this);
    this.normalizeRules();
  }

  oop.inherits(RHighlightRules, TextHighlightRules);

  exports.RHighlightRules = RHighlightRules;
  exports.setHighlightRFunctionCalls = function(value) {
    $colorFunctionCalls = value;
  };
});
/*
 * r_matching_brace_outdent.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/r_matching_brace_outdent", ["require", "exports", "module"], function(require, exports, module)
{
   var Range = require("ace/range").Range;

   var RMatchingBraceOutdent = function(codeModel) {
      this.codeModel = codeModel;
   };

   (function() {

      this.checkOutdent = function(state, line, input) {

         // Is the user inserting a bracket on a line that contains
         // only whitespace? If so, try to 'repair' the indent if necessary.
         if (/^\s+$/.test(line) && /^\s*[\{\}\)\]]/.test(input))
            return true;

         // Is the user inserting a newline on a line containing only '}'?
         // If so, we will want to re-indent that line.
         if (/^\s*}\s*$/.test(line) && input == "\n")
            return true;

         // This is the case of a newline being inserted on a line that contains
         // a bunch of stuff including }, and the user hits Enter. The input
         // is not necessarily "\n" because we may auto-insert some padding
         // as well.
         //
         // We don't always want to autoindent in this case; ideally we would
         // only autoindent if Enter was being hit right before }. But at this
         // time we don't have that information. So we let the autoOutdent logic
         // run and trust it to only outdent if appropriate.
         if (/}\s*$/.test(line) && /\n/.test(input))
            return true;

         return false;
      };

      this.autoOutdent = function(state, session, row) {

         if (row === 0)
            return;

         var line = session.getLine(row);
         var match = line.match(/^(\s*[\}\)\]])/);
         if (match)
         {
            var column = match[1].length;
            var openBracePos = session.findMatchingBracket({row: row, column: column});

            if (!openBracePos || openBracePos.row == row) return 0;

            var indent = this.codeModel.getIndentForOpenBrace(openBracePos);
            session.replace(new Range(row, 0, row, column - 1), indent);
         }

         match = line.match(/^(\s*\{)/);
         if (match)
         {
            var column = match[1].length;
            var indent = this.codeModel.getBraceIndent(row - 1);
            session.replace(new Range(row, 0, row, column - 1), indent);
         }

      };

   }).call(RMatchingBraceOutdent.prototype);

   exports.RMatchingBraceOutdent = RMatchingBraceOutdent;
});
/*
 * r_scope_tree.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define('mode/r_scope_tree', ["require", "exports", "module"], function(require, exports, module) {

   var $debuggingEnabled = false;
   function debuglog(str) {
      if ($debuggingEnabled)
         console.log(str);
   }

   function assert(condition, label) {
      if (!condition)
         window.alert("[ASSERTION FAILED] " + label);
   }

   function comparePoints(pos1, pos2) {
      if (pos1.row != pos2.row)
         return pos1.row - pos2.row;
      return pos1.column - pos2.column;
   }

   var ScopeNode = function(label, start, preamble, scopeType, attributes) {

      // The label associated with the scope.
      this.label = label;

      // The 'start' and the 'preamble' both denote where the node begins;
      // however, the 'start' is where parsing for the scope should begin (for
      // incremental scope tree builds).
      //
      // For example, given the function definition:
      //
      //    foo <- function(a, b, c) {
      //    ^ -- preamble
      //                             ^ -- start
      //
      // In general, these should be supplied separately -- otherwise, the
      // scope tree builder runs the risk of improperly adding duplicates of a
      // node when change events are emitted.
      this.start = start;

      // Validate that the preamble lies before the start.
      if (start && preamble)
      {
         if (preamble.row > start.row ||
             (preamble.row === start.row && preamble.column > start.column))
         {
            throw new Error("Malformed preamble: should lie before start position");
         }
      }

      this.preamble = preamble || start;

      // The end position of the scope.
      this.end = null;

      // The type of this scope (e.g. a braced scope, a section, and so on)
      this.scopeType = scopeType;

      // A pointer to the parent scope (if any; only the root scope should
      // have no parent)
      this.parentScope = null;

      // Generalized attributes (an object with names)
      this.attributes = attributes || {};

      // Child nodes
      this.$children = [];
   };

   ScopeNode.TYPE_ROOT = 1; // document root
   ScopeNode.TYPE_BRACE = 2; // curly brace
   ScopeNode.TYPE_CHUNK = 3; // Sweave chunk
   ScopeNode.TYPE_SECTION = 4; // Section header

   (function() {

      this.isRoot = function() { return this.scopeType == ScopeNode.TYPE_ROOT; };
      this.isBrace = function() { return this.scopeType == ScopeNode.TYPE_BRACE; };
      this.isChunk = function() { return this.scopeType == ScopeNode.TYPE_CHUNK; };
      this.isSection = function() { return this.scopeType == ScopeNode.TYPE_SECTION; };
      this.isFunction = function() { return this.isBrace() && !!this.attributes.args; };
      this.isTest = function() { return this.isBrace() && this.attributes.type === "test"; };

      this.equals = function(node) {
         if (this.scopeType !== node.scopeType ||
             this.start.row !== node.start.row ||
             this.start.column !== node.start.column)
         {
            return false;
         }

         return true;
      };

      this.addNode = function(node) {
         assert(!node.end, "New node is already closed");
         assert(node.$children.length == 0, "New node already had children");

         // Avoid adding duplicate nodes.
         if (this.equals(node))
            return;

         var index = this.$binarySearch(node.preamble);
         if (index >= 0) {
            // This node belongs inside an existing child
            this.$children[index].addNode(node);
         }
         else {
            // This node belongs directly under this scope. It's possible that
            // it subsumes some existing children under this scope. (We may not
            // know about a function scope until after we've seen some of its
            // children, since function scopes don't get created until we see
            // their opening brace but any argument defaults that are themselves
            // functions will have been seen already.)

            index = -(index+1);

            if (index < this.$children.length) {
               node.$children = this.$children.splice(
                                             index, this.$children.length - index);
            }
            node.parentScope = this;
            this.$children.push(node);
         }
      };

      this.closeScope = function(pos, scopeType) {

         // NB: This function will never close the "this" node. This is by
         // design as we don't want the top-level node to ever be closed.
         
         // No children
         if (this.$children.length == 0)
            return null;

         var lastNode = this.$children[this.$children.length-1];

         // Last child is already closed
         if (lastNode.end)
            return null;

         // Last child had a descendant that needed to be closed and was the
         // appropriate type
         var closedChild = lastNode.closeScope(pos, scopeType);
         if (closedChild)
            return closedChild;

         // Close last child, if it's of the type we want to close
         if (scopeType == lastNode.scopeType) {
            lastNode.end = pos;
            // If any descendants are still open, force them closed. This could
            // be the case for e.g. Sweave chunk being closed while it contains
            // unclosed brace scopes.
            lastNode.$forceDescendantsClosed(pos);
            return lastNode;
         }

         return null;
      };

      this.$forceDescendantsClosed = function(pos) {
         if (this.$children.length == 0)
            return;
         var lastNode = this.$children[this.$children.length - 1];
         if (lastNode.end)
            return;
         lastNode.$forceDescendantsClosed(pos);
         lastNode.end = pos;
      };

      // Returns array of nodes that contain the position, from outermost to
      // innermost; or null if no nodes contain it.
      this.findNode = function(pos) {
         var index = this.$binarySearch(pos);
         if (index >= 0) {
            var result = this.$children[index].findNode(pos);
            if (result) {
               if (this.label)
                  result.unshift(this);
               return result;
            }
            if (this.label)
               return [this];
            return null;
         }
         else {
            return this.label ? [this] : null;
         }
      };

      this.$getFunctionStack = function(pos) {
         var index = this.$binarySearch(pos);
         var stack = index >= 0 ? this.$children[index].$getFunctionStack(pos)
                                : [];
         if (this.isFunction()) {
            stack.push(this);
         }
         return stack;
      };

      this.findFunctionDefinitionFromUsage = function(usagePos, functionName) {
         var functionStack = this.$getFunctionStack(usagePos);
         for (var i = 0; i < functionStack.length; i++) {
            var thisLevel = functionStack[i];
            for (var j = 0; j < thisLevel.$children.length; j++) {
               // optionally, short-circuit iteration if usagePos comes before
               // thisLevel.$children[j].preamble (or .start?)
               if (thisLevel.$children[j].label == functionName)
                  return thisLevel.$children[j];
            }
         }

         return null;
      };

      // Get functions in scope. This returns an array of objects,
      // one object for each function, of the form:
      //
      // [{"name": fn, "args": ["arg1", "arg2", ...]}]
      //
      this.getFunctionsInScope = function(pos) {
         var stack = this.$getFunctionStack(pos);
         var objects = [];
         for (var i = 0; i < stack.length; i++)
         {
            objects.push({
               "name": stack[i].attributes.name,
               "args": stack[i].attributes.args.slice()
            });
         }
         return objects;
      };

      // Invalidates everything after pos, and possibly some stuff before.
      // Returns the position from which parsing should resume.
      this.invalidateFrom = function(pos) {

         var index = this.$binarySearch(pos);

         var resumePos;
         if (index >= 0)
         {
            // One of the child scopes contains this position (i.e. it's between
            // the preamble and end). Now figure out if the position is between
            // the child's start and end.

            if (comparePoints(pos, this.$children[index].start) <= 0)
            {
               // The position is between the child's preamble and the start.
               // We need to drop the child entirely and reparse.
               resumePos = this.$children[index].preamble;
            }
            else
            {
               // The position is between the child's start and end. We can keep
               // the scope, just recurse into the child to make sure its
               // children get invalidated correctly, and its 'end' property
               // is nulled out.
               resumePos = this.$children[index].invalidateFrom(pos);

               // Increment index so this child doesn't get removed.
               index++;
            }
         }
         else
         {
            index = -(index+1);
            resumePos = pos;
         }

         if (index < this.$children.length)
         {
            this.$children.splice(index, this.$children.length - index);
         }

         this.end = null;

         return resumePos;
      };

      // Returns index of the child that contains this position, if it exists;
      // otherwise, -(index + 1) where index is where such a child would be.
      this.$binarySearch = function(pos, start /*optional*/, end /*optional*/) {
         if (typeof(start) === 'undefined')
            start = 0;
         if (typeof(end) === 'undefined')
            end = this.$children.length;

         // No elements left to test
         if (start === end)
            return -(start + 1);

         var mid = Math.floor((start + end)/2);
         var comp = this.$children[mid].comparePosition(pos);
         if (comp === 0)
            return mid;
         else if (comp < 0)
            return this.$binarySearch(pos, start, mid);
         else // comp > 0
            return this.$binarySearch(pos, mid + 1, end);
      };

      this.comparePosition = function(pos)
      {
         // TODO
         if (comparePoints(pos, this.preamble) < 0)
            return -1;
         if (this.end != null && comparePoints(pos, this.end) >= 0)
            return 1;
         return 0;
      };

      this.printDebug = function(indent) {
         if (typeof(indent) === 'undefined')
            indent = "";

         debuglog(indent + "\"" + this.label + "\" ["
                        + this.preamble.row + "x" + this.preamble.column
                  + (this.start ? ("-" + this.start.row + "x" + this.start.column) : "")
                        + ", "
                        + (this.end ? (this.end.row + "x" + this.end.column) : "null" ) + "]");
         for (var i = 0; i < this.$children.length; i++)
            this.$children[i].printDebug(indent + "    ");
      };

   }).call(ScopeNode.prototype);

   
   // The 'ScopeNodeFactory' is a constructor of scope nodes -- it exists so that
   // we can properly perform inheritance for specializations of the ScopeNode 'class'.
   var ScopeManager = function(ScopeNodeFactory) {
      this.$ScopeNodeFactory = ScopeNodeFactory || ScopeNode;
      this.parsePos = {row: 0, column: 0};
      this.$root = new this.$ScopeNodeFactory("(Top Level)", this.parsePos, null,
                                 ScopeNode.TYPE_ROOT);
   };

   (function() {

      this.getParsePosition = function() {
         return this.parsePos;
      };

      this.setParsePosition = function(position) {
         this.parsePos = position;
      };

      this.onSectionStart = function(sectionLabel, sectionPos, attributes) {

         if (typeof attributes == "undefined")
            attributes = {};

         var existingScopes = this.getActiveScopes(sectionPos);

         // A section will close a previous section that exists as part
         // of that parent node (if it exists).
         if (existingScopes.length > 1)
         {
            var parentNode = existingScopes[existingScopes.length - 2];
            var children = parentNode.$children;
            for (var i = children.length - 1; i >= 0; i--)
            {
               if (children[i].isSection())
               {
                  this.$root.closeScope(sectionPos, ScopeNode.TYPE_SECTION);
                  break;
               }
            }
         }

         var node = new this.$ScopeNodeFactory(
            sectionLabel,
            sectionPos,
            sectionPos,
            ScopeNode.TYPE_SECTION,
            attributes
         );

         this.$root.addNode(node);
      };

      this.onSectionEnd = function(position)
      {
         this.$root.closeScope(position, ScopeNode.TYPE_SECTION);
      };

      // A little tricky: a new Markdown header will implicitly
      // close all previously open headers of greater or equal depth.
      //
      // For example:
      //
      //    # Top Level
      //    ## Sub Section
      //    ### Sub-sub Section
      //    ## Sub Section Two
      //
      // In the above case, the '## Sub Section Two' header will close both the
      // '### Sub-sub section' as well as the '## Sub-Section'
      this.closeMarkdownHeaderScopes = function(node, position, depth)
      {
         var children = node.$children;
         for (var i = children.length - 1; i >= 0; i--)
         {
            var child = children[i];
            if (child.isFunction() || child.isChunk())
               return;

            if (child.isSection() && child.attributes.depth >= depth)
            {
               debuglog("Closing Markdown scope: '" + child.label + "'");
               this.$root.closeScope(position, ScopeNode.TYPE_SECTION);
               if (child.attributes.depth === depth)
                  return;

               if (node.isRoot() || node == null)
                  return;

               return this.closeMarkdownHeaderScopes(node.parentScope, position, depth);
            }
         }

         if (node.isRoot() || node == null)
            return;
         
         this.closeMarkdownHeaderScopes(node.parentScope, position, depth);
      };

      this.onMarkdownHead = function(label, labelStartPos, labelEndPos, depth, isMarkdown)
      {
         debuglog("Adding Markdown header: '" + label + "' [" + depth + "]");
         var scopes = this.getActiveScopes(labelStartPos);
         if (scopes.length > 1)
            this.closeMarkdownHeaderScopes(scopes[scopes.length - 2], labelStartPos, depth);

         this.$root.addNode(new this.$ScopeNodeFactory(
            label,
            labelEndPos,
            labelStartPos,
            ScopeNode.TYPE_SECTION,
            {depth: depth, isMarkdown: isMarkdown}
         ));
      };

      /**
       * @param chunkLabel The actual label associated with the chunk.
       * @param label An alternate label with more information (e.g. used in the status bar)
       * @param chunkStartPos The start position of the chunk header.
       * @param chunkPos The start position of the chunk, excluding the chunk header.
       */
      this.onChunkStart = function(chunkLabel, label, chunkStartPos, chunkPos) {
         // Starting a chunk means closing the previous chunk, if any
         var prev = this.$root.closeScope(chunkStartPos, ScopeNode.TYPE_CHUNK);
         if (prev)
            debuglog("chunk-scope implicit end: " + prev.label);

         debuglog("adding chunk-scope " + label);
         var node = new this.$ScopeNodeFactory(label, chunkPos, chunkStartPos,
                                  ScopeNode.TYPE_CHUNK);
         node.chunkLabel = chunkLabel;
         this.$root.addNode(node);
         this.printScopeTree();
      };

      this.onChunkEnd = function(pos) {
         var closed = this.$root.closeScope(pos, ScopeNode.TYPE_CHUNK);
         if (closed)
            debuglog("chunk-scope end: " + closed.label);
         else
            debuglog("extra chunk-scope end");
         this.printScopeTree();
         return closed;
      };

      this.onFunctionScopeStart = function(label, functionStartPos, scopePos, name, args) {
         debuglog("adding function brace-scope " + label);
         this.$root.addNode(
            new this.$ScopeNodeFactory(
               label,
               scopePos,
               functionStartPos,
               ScopeNode.TYPE_BRACE,
               {
                  "name": name,
                  "args": args, 
                  "type": "function"
               }
            )
         );
         
         this.printScopeTree();
      };

      this.onTestScopeStart = function(desc, startPos, scopePos) {
         debuglog("adding test_that() brace-scope " + desc);
         var label = "test_that(" + desc + ")";
         var name = desc.replace(/^['"](.*)['"]/, "$1");
         
         this.$root.addNode(
            new this.$ScopeNodeFactory(
               label,
               scopePos,
               startPos,
               ScopeNode.TYPE_BRACE,
               {
                  "name": name,
                  "type": "test"
               }
            )
         );
         
         this.printScopeTree();
      }

      this.onNamedScopeStart = function(label, pos) {
         this.$root.addNode(new this.$ScopeNodeFactory(label, pos, null, ScopeNode.TYPE_BRACE));
      };

      this.onScopeStart = function(pos) {
         debuglog("adding anon brace-scope");
         this.$root.addNode(new this.$ScopeNodeFactory(null, pos, null,
                                          ScopeNode.TYPE_BRACE));
         this.printScopeTree();
      };

      this.onScopeEnd = function(pos) {
         var closed = this.$root.closeScope(pos, ScopeNode.TYPE_BRACE);
         if (closed)
            debuglog("brace-scope end: " + closed.label);
         else
            debuglog("extra brace-scope end");
         this.printScopeTree();
         return closed;
      };

      this.getActiveScopes = function(pos) {
         return this.$root.findNode(pos);
      };

      this.getScopeList = function() {
         return this.$root.$children;
      };

      this.findFunctionDefinitionFromUsage = function(usagePos, functionName) {
         return this.$root.findFunctionDefinitionFromUsage(usagePos,
                                                           functionName);
      };

      this.getFunctionsInScope = function(pos, tokenizer) {
         return this.$root.getFunctionsInScope(pos, tokenizer);
      };

      this.invalidateFrom = function(pos) {
         pos = {row: Math.max(0, pos.row-1), column: 0};
         debuglog("Invalidate from " + pos.row + ", " + pos.column);
         if (comparePoints(this.parsePos, pos) > 0)
            this.parsePos = this.$root.invalidateFrom(pos);
         this.printScopeTree();
      };

      function $getChunkCount(node) {
         count = node.isChunk() ? 1 : 0;
         var children = node.$children || [];
         for (var i = 0; i < children.length; i++)
            count += $getChunkCount(children[i]);
         return count;
      }

      this.getChunkCount = function(count) {
         return $getChunkCount(this.$root);
      };

      this.getTopLevelScopeCount = function() {
         return this.$root.$children.length;
      };

      this.printScopeTree = function() {
         if (!$debuggingEnabled)
            return;
         
         this.$root.printDebug();
      };

      this.getAllFunctionScopes = function() {
         var array = [];
         var node = this.$root;
         doGetAllFunctionScopes(node, array);
         return array;
      };

      var doGetAllFunctionScopes = function(node, array) {
         if (node.isFunction())
         {
            array.push(node);
         }
         var children = node.$children;
         for (var i = 0; i < children.length; i++)
         {
            doGetAllFunctionScopes(children[i], array);
         }
         
      };

   }).call(ScopeManager.prototype);


   exports.ScopeManager = ScopeManager;
   exports.ScopeNode = ScopeNode;

});
/*
 * rainbow_paren_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

var $rainbowParentheses = false;
var $numParenColors = 7;

define("mode/rainbow_paren_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

  var RainbowParenHighlightRules = function () {
  };

  exports.RainbowParenHighlightRules = RainbowParenHighlightRules;
  exports.setRainbowParentheses = function(value) {
    $rainbowParentheses = value;
  };
  exports.getRainbowParentheses = function() {
    return $rainbowParentheses;
  };
  exports.setNumParenColors = function(value) {
    $numParenColors = value;
  };

  RainbowParenHighlightRules.getParenRule = function() {
    return {
      token: "paren.keyword.operator.nomatch",
      regex: "[[({})\\]]",
      merge: false,
      onMatch: function (value, state, stack, line, context) {

        if (!$rainbowParentheses) {
          this.token = "paren.keyword.operator.nomatch";
          return this.token;
        }

        context.rainbow = context.rainbow || 0;

        switch (value) {

          case "[": case "{": case "(":
            this.token = `paren.paren_color_${context.rainbow % $numParenColors}`;
            context.rainbow += 1;
            break;

          case "]": case "}": case ")":
            context.rainbow = Math.max(0, context.rainbow - 1);
            this.token = `paren.paren_color_${context.rainbow % $numParenColors}`;
            break;
        }

        return this.token;
      }
    };
  }

});
/*
 * rdoc.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/rdoc", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var RDocHighlightRules = require("mode/rdoc_highlight_rules").RDocHighlightRules;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;

var Mode = function(suppressHighlighting) {
    if (suppressHighlighting)
    {
	this.$highlightRules = new TextHighlightRules();
    	this.$tokenizer = new Tokenizer(new TextHighlightRules().getRules());
    }
    else
    {
	this.$highlightRules = new RDocHighlightRules();
	this.$tokenizer = new Tokenizer(new RDocHighlightRules().getRules());
    }
    this.$outdent = new MatchingBraceOutdent();
};
oop.inherits(Mode, TextMode);

(function() {
    this.getNextLineIndent = function(state, line, tab) {
        return this.$getIndent(line);
    };
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * rdoc_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/rdoc_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var RDocHighlightRules = function() {

    // regexp must not have capturing parentheses. Use (?:) instead.
    // regexps are ordered -> the first match is used
    var keywords =
        "name|alias|method|S3method|S4method|item|code|" +
        "preformatted|kbd|pkg|var|env|option|command|author|" +
        "email|url|source|cite|acronym|href|code|preformatted|" +
        "link|eqn|deqn|keyword|usage|examples|dontrun|dontshow|" +
        "figure|if|ifelse|Sexpr|RdOpts|inputencoding|usepackage";

    keywords = "\\" + keywords.replace(/\|/g, "|\\");

    var keywordMapper = this.createKeywordMapper({
        "keyword": keywords
    }, "identifer");

    this.$rules = {
        "start" : [
	        {
	            token : "comment",
	            regex : "%.*$"
	        }, {
	            token : "text", // non-command
	            regex : "\\\\[$&%#\\{\\}]"
	        }, {
	            token : "keyword", // command
	            regex : "\\\\(?:name|alias|method|S3method|S4method|item|code|preformatted|kbd|pkg|var|env|option|command|author|email|url|source|cite|acronym|href|code|preformatted|link|eqn|deqn|keyword|usage|examples|dontrun|dontshow|figure|if|ifelse|Sexpr|RdOpts|inputencoding|usepackage)\\b",
               next : "nospell"
	        }, {
	            token : "keyword", // command
	            regex : "\\\\(?:[a-zA-z0-9]+|[^a-zA-z0-9])"
	        }, {
               // Obviously these are neither keywords nor operators, but
               // labelling them as such was the easiest way to get them
               // to be colored distinctly from regular text
               token : "paren.keyword.operator",
	            regex : "[[({]"
	        }, {
               // Obviously these are neither keywords nor operators, but
               // labelling them as such was the easiest way to get them
               // to be colored distinctly from regular text
               token : "paren.keyword.operator",
	            regex : "[\\])}]"
	        }, {
	            token : "text",
	            regex : "\\s+"
	        }
        ],
        // This mode is necessary to prevent spell checking, but to keep the
        // same syntax highlighting behavior.
        "nospell" : [
           {
               token : "comment",
               regex : "%.*$",
               next : "start"
           }, {
               token : "nospell.text", // non-command
               regex : "\\\\[$&%#\\{\\}]"
           }, {
               token : "keyword", // command
               regex : "\\\\(?:name|alias|method|S3method|S4method|item|code|preformatted|kbd|pkg|var|env|option|command|author|email|url|source|cite|acronym|href|code|preformatted|link|eqn|deqn|keyword|usage|examples|dontrun|dontshow|figure|if|ifelse|Sexpr|RdOpts|inputencoding|usepackage)\\b"
           }, {
               token : "keyword", // command
               regex : "\\\\(?:[a-zA-z0-9]+|[^a-zA-z0-9])",
               next : "start"
           }, {
               token : "paren.keyword.operator",
               regex : "[[({]"
           }, {
               token : "paren.keyword.operator",
               regex : "[\\])]"
           }, {
               token : "paren.keyword.operator",
               regex : "}",
               next : "start"
           }, {
               token : "nospell.text",
               regex : "\\s+"
           }, {
               token : "nospell.text",
               regex : "\\w+"
           }
        ]
    };
};

oop.inherits(RDocHighlightRules, TextHighlightRules);

exports.RDocHighlightRules = RDocHighlightRules;
});
/*
 * rhtml.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/rhtml", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var HtmlMode = require("ace/mode/html").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var RHtmlHighlightRules = require("mode/rhtml_highlight_rules").RHtmlHighlightRules;
var RCodeModel = require("mode/r_code_model").RCodeModel;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;
var RMatchingBraceOutdent = require("mode/r_matching_brace_outdent").RMatchingBraceOutdent;
var Utils = require("mode/utils");

var Mode = function(suppressHighlighting, session) {
   this.$session = session;
   this.$tokenizer = new Tokenizer(new RHtmlHighlightRules().getRules());

   this.codeModel = new RCodeModel(
      session,
      this.$tokenizer,
      /^r-/,
      /^<!--\s*begin.rcode\s*(.*)/,
      /^\s*end.rcode\s*-->/
   );

   this.$outdent = new MatchingBraceOutdent();
   this.$r_outdent = new RMatchingBraceOutdent(this.codeModel);
   
   this.foldingRules = this.codeModel;
};
oop.inherits(Mode, HtmlMode);

(function() {

   function activeMode(state)
   {
      return Utils.activeMode(state, "html");
   }

   this.insertChunkInfo = {
      value: "<!--begin.rcode\n\nend.rcode-->\n",
      position: {row: 0, column: 15},
      content_position: {row: 1, column: 0}
   };

   this.checkOutdent = function(state, line, input)
   {
      var mode = activeMode(state);
      if (mode === "r")
         return this.$r_outdent.checkOutdent(state, line, input);
      else
         return this.$outdent.checkOutdent(line, input);
   };

   this.autoOutdent = function(state, session, row)
   {
      var mode = activeMode(state);
      if (mode === "r")
         return this.$r_outdent.autoOutdent(state, session, row);
      else
         return this.$outdent.autoOutdent(session, row);
   };
    
   this.getLanguageMode = function(position)
   {
      var state = Utils.getPrimaryState(this.$session, position.row);
      return state.match(/^r-/) ? 'R' : 'HTML';
   };

   this.$getNextLineIndent = this.getNextLineIndent;
   this.getNextLineIndent = function(state, line, tab, row)
   {
      var mode = Utils.activeMode(state, "html");
      if (mode === "r")
         return this.codeModel.getNextLineIndent(state, line, tab, row);
      else
         return this.$getNextLineIndent(state, line, tab);
   };

   this.$id = "mode/rhtml";

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * rhtml_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/rhtml_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
var HtmlHighlightRules = require("ace/mode/html_highlight_rules").HtmlHighlightRules;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var RHtmlHighlightRules = function() {

    // regexp must not have capturing parentheses
    // regexps are ordered -> the first match is used

    this.$rules = new HtmlHighlightRules().getRules();
    this.$rules["start"].unshift({
        token: "support.function.codebegin",
        regex: "^<" + "!--\\s*begin.rcode\\s*(?:.*)",
        next: "r-start"
    });

    var rRules = new RHighlightRules().getRules();
    this.addRules(rRules, "r-");
    this.$rules["r-start"].unshift({
        token: "support.function.codeend",
        regex: "^\\s*end.rcode\\s*-->",
        next: "start"
    });
};
oop.inherits(RHtmlHighlightRules, TextHighlightRules);

exports.RHtmlHighlightRules = RHtmlHighlightRules;
});
/*
 * markdown.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/rmarkdown", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var MarkdownMode = require("mode/markdown").Mode;

var Tokenizer = require("ace/tokenizer").Tokenizer;
var RMarkdownHighlightRules = require("mode/rmarkdown_highlight_rules").RMarkdownHighlightRules;

var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;
var RMatchingBraceOutdent = require("mode/r_matching_brace_outdent").RMatchingBraceOutdent;
var CppMatchingBraceOutdent = require("mode/c_cpp_matching_brace_outdent").CppMatchingBraceOutdent;

var RCodeModel = require("mode/r_code_model").RCodeModel;
var CppCodeModel = require("mode/cpp_code_model").CppCodeModel;
var PythonMode = require("mode/python").Mode;

var RMarkdownFoldMode = require("rstudio/folding/rmarkdown").FoldMode;
var CFoldMode = require("ace/mode/folding/cstyle").FoldMode;

var AutoBraceInsert = require("mode/auto_brace_insert").AutoBraceInsert;

var Utils = require("mode/utils");
var unicode = require("ace/unicode");

var Mode = function(suppressHighlighting, session) {
   var that = this;

   this.$session = session;
   this.$tokenizer = new Tokenizer(new RMarkdownHighlightRules().getRules());
   this.$outdent = new MatchingBraceOutdent();

   this.codeModel = new RCodeModel(
      session,
      this.$tokenizer,
      /^r-/,
      new RegExp(RMarkdownHighlightRules.prototype.$reChunkStartString),
      new RegExp(RMarkdownHighlightRules.prototype.$reChunkEndString)
   );
   this.$r_outdent = new RMatchingBraceOutdent(this.codeModel);

   this.cpp_codeModel = new CppCodeModel(
      session,
      this.$tokenizer,
      /^r-cpp-/,
      new RegExp(RMarkdownHighlightRules.prototype.$reCppChunkStartString),
      new RegExp(RMarkdownHighlightRules.prototype.$reChunkEndString)
   );
   this.$cpp_outdent = new CppMatchingBraceOutdent(this.cpp_codeModel);

   this.$python = new PythonMode();

   var rMarkdownFoldingRules = new RMarkdownFoldMode();
   var cFoldingRules = new CFoldMode();

   // Patch tokenizer to allow for YAML start at beginning of document
   this.$tokenizer.getLineTokens = function(line, state, row, context) {
      return Tokenizer.prototype.getLineTokens.call(this, line, row === 0 ? "_start" : state, row, context);
   }

   // NOTE: R Markdown is in charge of generating all 'top-level' folds.
   // That is, for the YAML header, chunk boundaries, and Markdown headers.
   this.foldingRules = {

      getFoldWidget: function(session, foldStyle, row) {

         var position = {row: row, column: 0};
         var mode = that.getLanguageMode(position);
         var line = session.getLine(row);

         if (mode === "Markdown" || Utils.startsWith(line, "```") || row === 0)
            return rMarkdownFoldingRules.getFoldWidget(session, foldStyle, row);
         else if (mode === "C_CPP")
            return cFoldingRules.getFoldWidget(session, foldStyle, row);
         else
            return that.codeModel.getFoldWidget(session, foldStyle, row);
      },

      getFoldWidgetRange: function(session, foldStyle, row) {

         var position = {row: row, column: 0};
         var mode = that.getLanguageMode(position);
         var line = session.getLine(row);

         if (mode === "Markdown" || Utils.startsWith(line, "```") || row === 0)
            return rMarkdownFoldingRules.getFoldWidgetRange(session, foldStyle, row);
         else if (mode === "C_CPP")
            return cFoldingRules.getFoldWidgetRange(session, foldStyle, row);
         else
            return that.codeModel.getFoldWidgetRange(session, foldStyle, row);
      }

   };
};
oop.inherits(Mode, MarkdownMode);

(function() {

   function activeMode(state)
   {
      return Utils.activeMode(state, "markdown");
   }

   this.insertChunkInfo = {
      value: "```{r}\n\n```\n",
      position: {row: 0, column: 5},
      content_position: {row: 1, column: 0}
   };

   this.getLanguageMode = function(position)
   {
      var state = Utils.getPrimaryState(this.$session, position.row);
      var mode = activeMode(state);
      if (mode === "r")
         return "R";
      else if (mode === "r-cpp")
         return "C_CPP";
      else if (mode === "yaml")
         return "YAML";
      else if (mode === "python")
         return "Python";
      else if (mode == "sql")
         return "SQL";
      else if (mode === "stan")
         return "Stan";
      else
         return "Markdown";
   };

   this.$getNextLineIndent = this.getNextLineIndent;
   this.getNextLineIndent = function(state, line, tab, row, dontSubset)
   {
      var mode = activeMode(state);

      if (mode === "r")
         return this.codeModel.getNextLineIndent(state, line, tab, row);
      else if (mode === "r-cpp")
         return this.cpp_codeModel.getNextLineIndent(state, line, tab, row, dontSubset);
      else if (mode === "yaml")
         return this.$getIndent(this.$session.getLine(row + 1));
      else if (mode === "python")
         return this.$python.getNextLineIndent(state, line, tab, row);
      else
         return this.$getNextLineIndent(state, line, tab);
   };

   this.checkOutdent = function(state, line, input)
   {
      var mode = activeMode(state);
      if (mode === "r")
         return this.$r_outdent.checkOutdent(state, line, input);
      else if (mode === "r-cpp")
         return this.$cpp_outdent.checkOutdent(state, line, input);
      else if (mode === "yaml")
         return false;
      else
         return this.$outdent.checkOutdent(line, input);
   };

   this.autoOutdent = function(state, session, row)
   {
      var mode = activeMode(state);
      if (mode === "r")
         return this.$r_outdent.autoOutdent(state, session, row);
      else if (mode === "r-cpp")
         return this.$cpp_outdent.autoOutdent(state, session, row);
      else if (mode === "yaml")
         return;
      else if (mode === "python")
         return this.$python.autoOutdent(state, session, row);
      else
         return this.$outdent.autoOutdent(session, row);
   };

   this.getIndentForOpenBrace = function(openBracePos)
   {
      var state = Utils.getPrimaryState(this.$session, openBracePos.row);
      var mode = activeMode(state);
      if (mode === "r")
         return this.codeModel.getIndentForOpenBrace(openBracePos);

      var line = this.$session.getLine(openBracePos.row1);
      return this.$getIndent(line);
   };

   this.transformAction = function(state, action, editor, session, text)
   {
      var mode = activeMode(state);
      if (mode === "markdown")
         return this.transformActionMarkdown(state, action, editor, session, text);
      else if (mode === "r-cpp")
         return this.transformActionCpp(state, action, editor, session, text);
      else if (mode === "yaml")
         return this.transformActionYaml(state, action, editor, session, text);
      else if (mode === "python")
         return this.$python.transformAction(state, action, editor, session, text);
      else
         return false;
   };

   this.transformActionMarkdown = function(state, action, editor, session, text) {

      if (action === "insertion")
      {
         // if the user is typing '`r', complete the closing backtick
         if (text === "r")
         {
            var pos = editor.getCursorPosition();
            var line = session.getLine(pos.row);
            var token = session.getTokenAt(pos.row, pos.column - 1);

            // validate that we're not already working within an inline chunk --
            // check the token at cursor position for 'support.function' type
            // to confirm
            if (token !== null &&
                token.type.indexOf("support.function") === -1 &&
                line[pos.column - 1] === "`")
            {
               return {
                  text: "r`",
                  selection: [0, pos.column + 1, 0, pos.column + 1]
               };
            }
         }

         // skip over '`' if it ends an inline code block
         else if (text === "`")
         {
            var pos = editor.getCursorPosition();
            var line = session.getLine(pos.row);
            var token = session.getTokenAt(pos.row, pos.column + 1);

            if (token !== null &&
                token.type.indexOf("support.function") !== -1 &&
                line[pos.column] === "`")
            {
               return {
                  text: "",
                  selection: [0, pos.column + 1, 0, pos.column + 1]
               };
            }
         }
      }

   }

   this.transformActionCpp = function(state, action, editor, session, text) {

      // from c_cpp.js
      if (action === 'insertion') {
         if (text === "\n") {
            // If newline in a doxygen comment, continue the comment
            var pos = editor.getSelectionRange().start;
            var match = /^((\s*\/\/+')\s*)/.exec(session.doc.getLine(pos.row));
            if (match && editor.getSelectionRange().start.column >= match[2].length) {
               return {text: "\n" + match[1]};
            }
         }

         else if (text === "R") {
            // If newline to start and embedded R chunk complete the chunk
            var pos = editor.getSelectionRange().start;
            var match = /^(\s*\/\*{3,}\s*)/.exec(session.doc.getLine(pos.row));
            if (match && editor.getSelectionRange().start.column >= match[1].length) {
               return {text: "R\n\n*/\n",
                       selection: [1,0,1,0]};
            }
         }
      }

      return false;
   };

   this.transformActionYaml = function(state, action, editor, session, text)
   {
      if (action === "insertion")
      {
         if (text === "\n")
         {
            // get current line + indent
            var pos = editor.getCursorPosition();
            var row = pos.row;
            var line = session.getLine(row);
            var indent = this.$getIndent(line);

            // if this line ends with a ':' or opening bracket,
            // then add some indent
            if (/[:({[]$/.test(line)) {
               var tab = this.$session.getTabString();
               return {
                  text: "\n" + indent + tab
               };
            }

            // otherwise, just preserve the current indent
            return {
               text: "\n" + indent
            };
         }
      }

      return false;
   };

   this.tokenRe = new RegExp("^[" + unicode.wordChars + "._]+", "g");
   this.nonTokenRe = new RegExp("^(?:[^" + unicode.wordChars + "._]|\\s)+", "g");

   this.allowAutoInsert = this.smartAllowAutoInsert;

   this.$id = "mode/rmarkdown";

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * rmarkdown_folding.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/folding/rmarkdown", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var BaseFoldMode = require("ace/mode/folding/fold_mode").FoldMode;
var Range = require("ace/range").Range;
var Utils = require("mode/utils");

var FoldMode = exports.FoldMode = function() {};
oop.inherits(FoldMode, BaseFoldMode);

var RE_FOLD_BEGIN = /(?:^|[.])(?:codebegin|heading)(?:$|[.])/;
var RE_FOLD_END   = /(?:^|[.])(?:codeend)(?:$|[.])/;

var FOLD_STYLE_MARKBEGINEND = "markbeginend";

var FOLD_WIDGET_NONE  = "";
var FOLD_WIDGET_START = "start";
var FOLD_WIDGET_END   = "end";

(function() {

   var $findNextHeader = function(session, state, row, depth) {
      var n = session.getLength();
      for (var i = row + 1; i < n; i++) {
         // Check the state and guard against R comments
         var rowState = session.getState(i);
         if (rowState !== state)
            continue;

         var line = session.getLine(i);
         if (depth === 1 && /^[=]{3,}\s*/.test(line))
            return i - 2;
         
         if (depth === 2 && /^[-]{3,}\s*/.test(line))
            return i - 2;

         var match = /^(#+)(?:.*)$/.exec(line);
         if (match && match[1].length <= depth)
            return i - 1;
      }
      return n;
   };

   // NOTE: 'increment' is either 1 or -1, defining whether we are
   // looking forward or backwards. It's encoded this way both for
   // efficiency and to avoid duplicating this function for each
   // direction.
   this.$getBracedWidgetRange = function(session, foldStyle, row, pattern) {

      // Get the fold widget for this row.
      var widget = this.getFoldWidget(session, foldStyle, row);
      if (widget === FOLD_WIDGET_NONE) {
         return null;
      }

      // Figure out if we're looking forward for an end widget, or backwards
      // for a beginning widget.
      var increment, limit;
      if (widget === FOLD_WIDGET_START) {
         increment = 1;
         limit = session.getLength();
         if (row >= limit) {
            return null;
         }
      } else if (widget === FOLD_WIDGET_END) {
         increment = -1;
         limit = 0;
         if (row <= limit) {
            return null;
         }
      }
      
      // Find the end of the current fold range. Iterate through lines and apply
      // our fold pattern until we get a match.
      var startRow = row;
      var endRow = row + increment;
      while (endRow !== limit) {

         var line = session.getLine(endRow);
         if (pattern.test(line))
            break;

         endRow += increment;
      }
      
      // Build the fold range. Note that if we were folding backwards, then the
      // discovered 'endRow' would lie earlier in the document, on the row where
      // the fold region starts -- hence, the sort of 'mirroring' in the code below.
      if (widget === FOLD_WIDGET_START) {
         var startPos = { row: startRow, column: session.getLine(startRow).length };
         var endPos = { row: endRow, column: 0 };
         return Range.fromPoints(startPos, endPos);
      } else {
         var startPos = { row: endRow, column: session.getLine(endRow).length };
         var endPos = { row: startRow, column: 0 };
         return Range.fromPoints(startPos, endPos);
      }
      
   };


   this.getFoldWidget = function(session, foldStyle, row) {

      var tokens = session.getTokens(row);
      for (var token of tokens) {
         var type = token.type || "";
         if (RE_FOLD_BEGIN.test(type)) {
            return FOLD_WIDGET_START;
         } else if (RE_FOLD_END.test(type)) {
            return foldStyle === FOLD_STYLE_MARKBEGINEND ? FOLD_WIDGET_END : FOLD_WIDGET_NONE;
         }
      }

      return FOLD_WIDGET_NONE;
   };

   this.$getFoldWidgetRange = function(session, foldStyle, row) {

      var state = session.getState(row);
      var line = session.getLine(row);
      var trimmed = line.trim();

      // Handle chunk folds.
      var match = /^\s*(`{3,})/.exec(line);
      if (match !== null) {
         var pattern = new RegExp("^\\s*(`{" + match[1].length + "})(?!`)");
         return this.$getBracedWidgetRange(session, foldStyle, row, pattern);
      }

      // Handle YAML header.
      var prevState = row > 0 ? session.getState(row - 1) : "start";
      var isYamlStart = row === 0 && trimmed === "---";
      if (isYamlStart) {
         var pattern = /^\s*---\s*$/;
         return this.$getBracedWidgetRange(session, foldStyle, row, pattern);
      }

      var isYamlEnd = Utils.startsWith(prevState, "yaml");
      if (isYamlEnd) {
         var pattern = /^\s*(?:---|\.\.\.)\s*$/;
         return this.$getBracedWidgetRange(session, foldStyle, row, pattern);
      }
      
      // Handle Markdown header folds. They fold up until the next
      // header of the same depth.
      var depth;
      if (line[0] === '=')
         depth = 1;
      else if (line[0] === '-')
         depth = 2;
      else
      {
         var match = /^(#+)(?:.*)$/.exec(line);
         if (!match)
            return;
         
         depth = match[1].length;
      }

      if (depth === null)
         return;

      var endRow = $findNextHeader(session, state, row, depth);
      return new Range(row, line.length, endRow, session.getLine(endRow).length);

   };

   this.getFoldWidgetRange = function(session, foldStyle, row) {

      var range = this.$getFoldWidgetRange(session, foldStyle, row);

      // Protect against null ranges
      if (range == null)
         return;

      // Ace will throw an error if the range does not span at least
      // two characters.  Returning 'undefined' will instead cause the
      // widget to be colored red, to indicate that it was unable to
      // fold the region following.  This is (probably?) preferred,
      // although the red background treatment feels a bit too
      // negative.
      if (range.start.row === range.end.row)
         return;

      return range;
   };

}).call(FoldMode.prototype);

});
/*
 * markdown_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/rmarkdown_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
var c_cppHighlightRules = require("mode/c_cpp_highlight_rules").c_cppHighlightRules;
var PerlHighlightRules = require("ace/mode/perl_highlight_rules").PerlHighlightRules;
var PythonHighlightRules = require("mode/python_highlight_rules").PythonHighlightRules;
var RubyHighlightRules = require("ace/mode/ruby_highlight_rules").RubyHighlightRules;
var MarkdownHighlightRules = require("mode/markdown_highlight_rules").MarkdownHighlightRules;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var YamlHighlightRules = require("mode/yaml_highlight_rules").YamlHighlightRules;
var ShHighlightRules = require("mode/sh_highlight_rules").ShHighlightRules;
var StanHighlightRules = require("mode/stan_highlight_rules").StanHighlightRules;
var SqlHighlightRules = require("mode/sql_highlight_rules").SqlHighlightRules;
var LatexHighlightRules = require("mode/tex_highlight_rules").LatexHighlightRules;
var JavaScriptHighlightRules = require("ace/mode/javascript_highlight_rules").JavaScriptHighlightRules;
var CssHighlightRules = require("ace/mode/css_highlight_rules").CssHighlightRules;
var ScssHighlightRules = require("ace/mode/scss_highlight_rules").ScssHighlightRules;
var SassHighlightRules = require("ace/mode/sass_highlight_rules").SassHighlightRules;
var LessHighlightRules = require("ace/mode/less_highlight_rules").LessHighlightRules;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var MermaidHighlightRules = require("mode/mermaid_highlight_rules").MermaidHighlightRules;
var DotHighlightRules = require("ace/mode/dot_highlight_rules").DotHighlightRules;

var Utils = require("mode/utils");

function makeDateRegex()
{
   var months = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];

   var reString =
          "((?:" + months.join("|") + ")\\s+\\d+(?:st|nd|rd|s|n|r)?(?:\\s*(?:,)?(?:\\s*\\d+)?)?)";

   return new RegExp(reString);
}

var RMarkdownHighlightRules = function() {

   // Base rule set (markdown)
   this.$rules = new MarkdownHighlightRules().getRules();

   // use '_start' rule so that YAML rules can apply only there
   this.$rules["_start"] = this.$rules["allowBlock"].slice();

   // Embed R highlight rules
   Utils.embedRules(
      this,
      RHighlightRules,
      "r",
      this.$reChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed R highlight rules for inline chunks
   // NOTE: disabled for now as we need to do more work to ensure
   // such inline chunks are properly disambiguated from regular chunks
   // Utils.embedRules(
   //    this,
   //    RHighlightRules,
   //    "r-inline",
   //    "`r ",
   //    "`",
   //    ["start", "listblock", "allowBlock"]
   // );


   // Embed C++ highlight rules
   Utils.embedRules(
      this,
      c_cppHighlightRules,
      "r-cpp",
      this.$reCppChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed perl highlight rules
   Utils.embedRules(
      this,
      PerlHighlightRules,
      "perl",
      this.$rePerlChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed python highlight rules
   Utils.embedRules(
      this,
      PythonHighlightRules,
      "python",
      this.$rePythonChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed ruby highlight rules
   Utils.embedRules(
      this,
      RubyHighlightRules,
      "ruby",
      this.$reRubyChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed Markdown highlight rules (for bookdown)
   Utils.embedRules(
      this,
      MarkdownHighlightRules,
      "markdown",
      this.$reMarkdownChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed shell scripting highlight rules (sh, bash)
   Utils.embedRules(
      this,
      ShHighlightRules,
      "sh",
      this.$reShChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed stan highlighting rules
   Utils.embedRules(
      this,
      StanHighlightRules,
      "stan",
      this.$reStanChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed sql highlighting rules
   Utils.embedRules(
      this,
      SqlHighlightRules,
      "sql",
      this.$reSqlChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed mermaid highlight rules
   Utils.embedRules(
      this,
      MermaidHighlightRules,
      "mermaid",
      this.$reMermaidChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed dot highlight rules
   Utils.embedRules(
      this,
      DotHighlightRules,
      "dot",
      this.$reDotChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed JavaScript highlighting rules
   Utils.embedRules(
      this,
      JavaScriptHighlightRules,
      "js",
      this.$reJavaScriptChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed css highlighting rules
   Utils.embedRules(
      this,
      CssHighlightRules,
      "css",
      this.$reCssChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed scss highlighting rules
   Utils.embedRules(
      this,
      ScssHighlightRules,
      "scss",
      this.$reScssChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed sass highlighting rules
   Utils.embedRules(
      this,
      SassHighlightRules,
      "sass",
      this.$reSassChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed less highlighting rules
   Utils.embedRules(
      this,
      LessHighlightRules,
      "less",
      this.$reLessChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed latex highlight rules
   Utils.embedRules(
      this,
      LatexHighlightRules,
      "tex",
      this.$reLatexChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed text highlight rules
   Utils.embedRules(
      this,
      TextHighlightRules,
      "text",
      this.$reTextChunkStartString,
      this.$reChunkEndString,
      ["start", "listblock", "allowBlock"]
   );

   // Embed YAML header highlighting rules
   Utils.embedRules(
      this,
      YamlHighlightRules,
      "yaml",
      "^\\s*---\\s*$",
      "^\\s*(?:---|\\.\\.\\.)\\s*$",
      ["_start"]
   );

   this.$rules["yaml-start"].unshift({
      token: ["string"],
      regex: makeDateRegex()
   });

   this.$rules["yaml-start"].push({
      defaultToken: "text.nospell"
   });

   this.normalizeRules();

};
oop.inherits(RMarkdownHighlightRules, TextHighlightRules);

(function() {

   function engineRegex(engine) {
      return "^(?:[ ]{4})?`{3,}\\s*\\{[Rr]\\b(?:.*)engine\\s*\\=\\s*['\"]" + engine + "['\"](?:.*)\\}\\s*$|" +
         "^(?:[ ]{4})?`{3,}\\s*\\{" + engine + "\\b(?:.*)\\}\\s*$";
   }

   this.$reChunkStartString =
      "^(?:[ ]{4})?`{3,}\\s*\\{\\w+\\b(.*)\\}\\s*$";

   this.$reChunkEndString =
      "^(?:[ ]{4})?`{3,}\\s*$";

   this.$reCppChunkStartString        = engineRegex("(?:[rR][cC]pp|[cC](?:pp)?)\\d*");
   this.$reMarkdownChunkStartString   = engineRegex("block");
   this.$rePerlChunkStartString       = engineRegex("perl");
   this.$rePythonChunkStartString     = engineRegex("python");
   this.$reMermaidChunkStartString    = engineRegex("mermaid");
   this.$reDotChunkStartString        = engineRegex("dot");
   this.$reRubyChunkStartString       = engineRegex("ruby");
   this.$reShChunkStartString         = engineRegex("(?:bash|sh)");
   this.$reStanChunkStartString       = engineRegex("stan");
   this.$reSqlChunkStartString        = engineRegex("sql");
   this.$reJavaScriptChunkStartString = engineRegex("(?:d3|js|ojs|observable)");
   this.$reCssChunkStartString        = engineRegex("css");
   this.$reScssChunkStartString       = engineRegex("scss");
   this.$reSassChunkStartString       = engineRegex("sass");
   this.$reLessChunkStartString       = engineRegex("less");
   this.$reTextChunkStartString       = engineRegex("(?:asis|text|verbatim)");
   this.$reLatexChunkStartString      = engineRegex("(?:tikz|latex|tex)");

}).call(RMarkdownHighlightRules.prototype);

exports.RMarkdownHighlightRules = RMarkdownHighlightRules;
});
/*
 * sh.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/sh", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var ShHighlightRules = require("mode/sh_highlight_rules").ShHighlightRules;
var Range = require("ace/range").Range;
var CStyleFoldMode = require("ace/mode/folding/cstyle").FoldMode;
var CstyleBehaviour = require("ace/mode/behaviour/cstyle").CstyleBehaviour;

var Mode = function() {
    this.HighlightRules = ShHighlightRules;
    this.foldingRules = new CStyleFoldMode();
    this.$behaviour = new CstyleBehaviour();
};
oop.inherits(Mode, TextMode);

(function() {

    this.lineCommentStart = "#";

    this.getNextLineIndent = function(state, line, tab) {
        var indent = this.$getIndent(line);

        var tokenizedLine = this.getTokenizer().getLineTokens(line, state);
        var tokens = tokenizedLine.tokens;

        if (tokens.length && tokens[tokens.length-1].type == "comment") {
            return indent;
        }

        if (state == "start") {
            var match = line.match(/^.*[\{\(\[:]\s*$/);
            if (match) {
                indent += tab;
            }
        }

        return indent;
    };

    var outdents = {
        "pass": 1,
        "return": 1,
        "raise": 1,
        "break": 1,
        "continue": 1
    };

    this.checkOutdent = function(state, line, input) {
        if (input !== "\r\n" && input !== "\r" && input !== "\n")
            return false;

        var tokens = this.getTokenizer().getLineTokens(line.trim(), state).tokens;

        if (!tokens)
            return false;

        // ignore trailing comments
        do {
            var last = tokens.pop();
        } while (last && (last.type == "comment" || (last.type == "text" && last.value.match(/^\s+$/))));

        if (!last)
            return false;

        return (last.type == "keyword" && outdents[last.value]);
    };

    this.autoOutdent = function(state, doc, row) {
        // outdenting in sh is slightly different because it always applies
        // to the next line and only of a new line is inserted

        row += 1;
        var indent = this.$getIndent(doc.getLine(row));
        var tab = doc.getTabString();
        if (indent.slice(-tab.length) == tab)
            doc.remove(new Range(row, indent.length-tab.length, row, indent.length));
    };

    this.$id = "mode/sh";
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * sh_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/sh_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var reservedKeywords = exports.reservedKeywords = (
        '!|{|}|case|do|done|elif|else|'+
        'esac|fi|for|if|in|then|until|while|'+
        '&|;|export|local|read|typeset|unset|'+
        'elif|select|set|function|declare|readonly'
    );

var languageConstructs = exports.languageConstructs = (
    '[|]|alias|bg|bind|break|builtin|'+
     'cd|command|compgen|complete|continue|'+
     'dirs|disown|echo|enable|eval|exec|'+
     'exit|fc|fg|getopts|hash|help|history|'+
     'jobs|kill|let|logout|popd|printf|pushd|'+
     'pwd|return|set|shift|shopt|source|'+
     'suspend|test|times|trap|type|ulimit|'+
     'umask|unalias|wait'
);

var ShHighlightRules = function() {
    var keywordMapper = this.createKeywordMapper({
        "keyword": reservedKeywords,
        "support.function.builtin": languageConstructs,
        "invalid.deprecated": "debugger"
    }, "identifier");

    var integer = "(?:(?:[1-9]\\d*)|(?:0))";
    // var integer = "(?:" + decimalInteger + ")";

    var fraction = "(?:\\.\\d+)";
    var intPart = "(?:\\d+)";
    var pointFloat = "(?:(?:" + intPart + "?" + fraction + ")|(?:" + intPart + "\\.))";
    var exponentFloat = "(?:(?:" + pointFloat + "|" +  intPart + ")" + ")";
    var floatNumber = "(?:" + exponentFloat + "|" + pointFloat + ")";
    var fileDescriptor = "(?:&" + intPart + ")";

    var variableName = "[a-zA-Z_][a-zA-Z0-9_]*";
    var variable = "(?:" + variableName + "(?==))";

    var builtinVariable = "(?:\\$(?:SHLVL|\\$|\\!|\\?))";

    var func = "(?:" + variableName + "\\s*\\(\\))";

    this.$rules = {
        "start" : [{
            token : "constant",
            regex : /\\./
        }, {
            token : ["text", "comment"],
            regex : /(^|\s)(#.*)$/
        }, {
            token : "string.start",
            regex : '"',
            push : [{
                token : "constant.language.escape",
                regex : /\\(?:[$`"\\]|$)/
            }, {
                include : "variables"
            }, {
                token : "keyword.operator",
                regex : /`/ // TODO highlight `
            }, {
                token : "string.end",
                regex : '"',
                next  : "pop"
            }, {
                defaultToken: "string"
            }]
        }, {
            token : "string",
            regex : "\\$'",
            push : [{
                token : "constant.language.escape",
                regex : /\\(?:[abeEfnrtv\\'"]|x[a-fA-F\d]{1,2}|u[a-fA-F\d]{4}([a-fA-F\d]{4})?|c.|\d{1,3})/
            }, {
                token : "string",
                regex : "'",
                next  : "pop"
            }, {
                defaultToken: "string"
            }]
        }, {
            regex : "<<<",
            token : "keyword.operator"
        }, {
            stateName: "heredoc",
            regex : "(<<-?)(\\s*)(['\"`]?)([\\w\\-]+)(['\"`]?)",
            onMatch : function(value, currentState, stack) {

                // Extract prefix from current state, using the fact
                // that it must end in 'start'
                var prefix = currentState.substring(0, currentState.length - 5);

                // Figure out the next state
                var next;
                if (value[2] === "-")
                    next = prefix + "indentedHeredoc";
                else
                    next = prefix + "heredoc";

                // Split tokens based on the used regex, and
                // save the end marker + current state.
                var tokens = value.split(this.splitRegex);
                stack.push(next, tokens[4], currentState);

                // Return the actual tokens.
                return [
                    {type:"constant", value: tokens[1]},
                    {type:"text", value: tokens[2]},
                    {type:"string", value: tokens[3]},
                    {type:"support.class", value: tokens[4]},
                    {type:"string", value: tokens[5]}
                ];
            },
            rules: {
                heredoc: [{
                    onMatch:  function(value, currentState, stack) {
                        if (value === stack[1]) {
                            this.next = stack[2];
                            stack.splice(-3);
                            return "support.class";
                        }
                        this.next = "";
                        return "string";
                    },
                    regex: ".*$"
                }],
                indentedHeredoc: [{
                    token: "string",
                    regex: "^\t+"
                }, {
                    onMatch:  function(value, currentState, stack) {
                        if (value === stack[1]) {
                            this.next = stack[2];
                            stack.splice(-3);
                            return "support.class";
                        }
                        this.next = "";
                        return "string";
                    },
                    regex: ".*$"
                }]
            }
        }, {
            regex : "$",
            token : "empty",
            next : function(currentState, stack) {
                // Since we could have an arbitrary prefix, just
                // check that our state ends with 'heredoc'.
                if (/heredoc$/i.test(stack[0]))
                    return stack[0];
                return currentState;
            }
        }, {
            token : ["keyword", "text", "text", "text", "variable"],
            regex : /(declare|local|readonly)(\s+)(?:(-[fixar]+)(\s+))?([a-zA-Z_][a-zA-Z0-9_]*\b)/
        }, {
            token : "variable.language",
            regex : builtinVariable
        }, {
            token : "variable",
            regex : variable
        }, {
            include : "variables"
        }, {
            token : "support.function",
            regex : func
        }, {
            token : "support.function",
            regex : fileDescriptor
        }, {
            token : "string",           // ' string
            start : "'", end : "'"
        }, {
            token : "constant.numeric", // float
            regex : floatNumber
        }, {
            token : "constant.numeric", // integer
            regex : integer + "\\b"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_][a-zA-Z0-9_]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+|\\-|\\*|\\*\\*|\\/|\\/\\/|~|<|>|<=|=>|=|!=|[%&|`]"
        }, {
            token : "punctuation.operator",
            regex : ";"
        }, {
            token : "paren.lparen",
            regex : "[\\[\\(\\{]"
        }, {
            token : "paren.rparen",
            regex : "[\\]]"
        }, {
            token : "paren.rparen",
            regex : "[\\)\\}]",
            next  : function(currentState, stack) {

                // NOTE (kevin): I'm not exactly sure why, but it appears as
                // though states can be duplicated on the stack when they are
                // pushed. Similar logic lives in Ace's own
                // text_highlight_rules.js, so we just follow in their
                // footsteps here but be a bit more careful about popping out
                // of the 'start' state.
                if (stack.length < 2)
                    return currentState;

                stack.shift();
                return stack.shift();
            }
        }],
        variables: [{
            token : "variable",
            regex : /(\$)(\w+)/
        }, {
            token : ["variable", "paren.lparen"],
            regex : /(\$)(\()/,
            push : "start"
        }, {
            token : ["variable", "paren.lparen", "keyword.operator", "variable", "keyword.operator"],
            regex : /(\$)(\{)([#!]?)(\w+|[*@#?\-$!0_])(:[?+\-=]?|##?|%%?|,,?\/|\^\^?)?/,
            push : "start"
        }, {
            token : "variable",
            regex : /\$[*@#?\-$!0_]/
        }, {
            token : ["variable", "paren.lparen"],
            regex : /(\$)(\{)/,
            push : "start"
        }]
    };
    
    this.normalizeRules();
};

oop.inherits(ShHighlightRules, TextHighlightRules);

exports.ShHighlightRules = ShHighlightRules;
});
/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/sql", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var SqlHighlightRules = require("mode/sql_highlight_rules").SqlHighlightRules;
var Range = require("ace/range").Range;

var Mode = function() {
    this.HighlightRules = SqlHighlightRules;
};
oop.inherits(Mode, TextMode);

(function() {

    this.lineCommentStart = "--";

    this.$id = "mode/sql";
}).call(Mode.prototype);

exports.Mode = Mode;

});
/*
 * sql_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is Jeffrey Arnold
 * Portions created by the Initial Developer are Copyright (C) 2014
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/sql_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

  var oop = require("ace/lib/oop");
  var lang = require("ace/lib/lang");
  var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

  var SqlHighlightRules = function() {
    var keywords = (
        "select|insert|update|delete|from|where|and|or|group|by|order|limit|offset|having|as|case|" +
        "when|else|end|type|left|right|join|on|outer|desc|asc|union|create|table|primary|key|if|" +
        "foreign|not|references|default|null|inner|cross|natural|database|drop|grant|into|values|" +
        "between|like|in|alter|index|view|exists|full|distinct|top|truncate|all"
    );

    var builtinConstants = (
        "true|false"
    );

    var builtinFunctions = (
        "avg|count|first|last|max|min|sum|ucase|lcase|mid|len|round|rank|now|format|" + 
        "coalesce|ifnull|isnull|nvl"
    );

    var dataTypes = (
        "int|numeric|decimal|date|varchar|char|bigint|float|double|bit|binary|text|set|timestamp|" +
        "money|real|number|integer"
    );

    var keywordMapper = this.createKeywordMapper({
        "support.function": builtinFunctions,
        "keyword": keywords,
        "constant.language": builtinConstants,
        "storage.type": dataTypes
    }, "identifier", true);

    this.$rules = {
        "start" : [ {
            token : "comment",
            regex : "--.*$"
        },  {
            token : "comment",
            start : "/\\*",
            end : "\\*/"
        }, {
            token: "comment",
            regex: "^#.*$"
        }, {
          token : "comment.doc.tag",
          regex : "\\?[a-zA-Z_][a-zA-Z0-9_$]*"
        }, {
            // Obviously these are neither keywords nor operators, but
            // labelling them as such was the easiest way to get them
            // to be colored distinctly from regular text
            token : "paren.keyword.operator",
            merge : false,
            regex : "[[({]",
            next  : "start"
        },
        {
            // Obviously these are neither keywords nor operators, but
            // labelling them as such was the easiest way to get them
            // to be colored distinctly from regular text
            token : "paren.keyword.operator",
            merge : false,
            regex : "[\\])}]",
            next  : "start"
        }, {
            token : "string",           // " string
            regex : '".*?"'
        }, {
            token : "string",           // ' string
            regex : "'.*?'"
        }, {
            token : "constant.numeric", // float
            regex : "[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+|\\-|\\/|\\/\\/|%|<@>|@>|<@|&|\\^|~|<|>|<=|=>|==|!=|<>|=|\\."
        }, {
            token : "paren.lparen",
            regex : "[\\(]"
        }, {
            token : "paren.rparen",
            regex : "[\\)]"
        }, {
            token : "text",
            regex : "\\s+"
        }]
    };
    this.normalizeRules();
  };

  oop.inherits(SqlHighlightRules, TextHighlightRules);

  exports.SqlHighlightRules = SqlHighlightRules;
});
/*
 * stan.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/stan", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;
var StanHighlightRules = require("mode/stan_highlight_rules").StanHighlightRules;
var StanFoldMode = require("ace/mode/folding/cstyle").FoldMode;

var Mode = function() {
   this.$highlightRules = new StanHighlightRules();
   this.$tokenizer = new Tokenizer(this.$highlightRules.getRules());
   this.$outdent = new MatchingBraceOutdent();
   this.foldingRules = new StanFoldMode();
};
oop.inherits(Mode, TextMode);

(function() {

   this.lineCommentStart = ["//", "#"];
   this.blockComment = {start: "/*", end: "*/"};

   this.toggleCommentLines = function(state, doc, startRow, endRow) {
      var outdent = true;
      var re = /^(\s*)\/\//;

      for (var i=startRow; i<= endRow; i++) {
         if (!re.test(doc.getLine(i))) {
            outdent = false;
            break;
         }
      }

      if (outdent) {
         var deleteRange = new Range(0, 0, 0, 0);
         for (var i = startRow; i <= endRow; i++)
         {
            var line = doc.getLine(i);
            var m = line.match(re);
            deleteRange.start.row = i;
            deleteRange.end.row = i;
            deleteRange.end.column = m[0].length;
            doc.replace(deleteRange, m[1]);
         }
      }
      else {
         doc.indentRows(startRow, endRow, "//");
      }
   };

   this.getLanguageMode = function(position) {
      return "Stan";
   };

   this.getNextLineIndent = function(state, line, tab) {
      var indent = this.$getIndent(line);

      var tokenizedLine = this.getTokenizer().getLineTokens(line, state);
      var tokens = tokenizedLine.tokens;
      var endState = tokenizedLine.state;

      if (tokens.length && tokens[tokens.length - 1].type == "comment") {
         return indent;
      }

      if (state == "start") {
         var match = line.match(/^.*(?:[\{\(\[])\s*$/);
         if (match) {
            indent += tab;
         }
      }

      return indent;
   };


   this.checkOutdent = function(state, line, input) {
      return this.$outdent.checkOutdent(line, input);
   };

   this.autoOutdent = function(state, doc, row) {
      this.$outdent.autoOutdent(doc, row);
   };

   this.$id = "mode/stan";

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
* stan_highlight_rules.js
*
* Copyright (C) 2022 by Posit Software, PBC
*
* The Initial Developer of the Original Code is Jeffrey Arnold
* Portions created by the Initial Developer are Copyright (C) 2014
* the Initial Developer. All Rights Reserved.
*
* Unless you have received this program directly from Posit Software pursuant
* to the terms of a commercial license agreement with Posit Software, then
* this program is licensed to you under the terms of version 3 of the
* GNU Affero General Public License. This program is distributed WITHOUT
* ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
* MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
* AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
*
*/

define("mode/stan_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

  var oop = require("ace/lib/oop");
  var lang = require("ace/lib/lang");
  var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

  var StanHighlightRules = function() {

    var variableName = "[a-zA-Z][a-zA-Z0-9_]*(?!__)\\b";
    var keywordsControl = "\\b(for|in|while|if|then|else|return)\\b";
    var keywordFunctions = "\\b(print|reject)\\b";
    var storageTypes = "\\b(int|real|vector|simplex|unit_vector|ordered|positive_ordered|row_vector|matrix|cholesky_factor_cov|cholesky_factor_corr|corr_matrix|cov_matrix|void)\\b";

    // --- Generated by https://github.com/jrnold/stan-language-definitions/blob/master/tools/rstudio.py
    var functionList = "\\b(Phi|Phi_approx|abs|acos|acosh|append_col|append_row|asin|asinh|atan|atan2|atanh|bernoulli_cdf|bernoulli_lccdf|bernoulli_lcdf|bernoulli_logit_lpmf|bernoulli_lpmf|bernoulli_rng|bessel_first_kind|bessel_second_kind|beta_binomial_cdf|beta_binomial_lccdf|beta_binomial_lcdf|beta_binomial_lpmf|beta_binomial_rng|beta_cdf|beta_lccdf|beta_lcdf|beta_lpdf|beta_rng|binary_log_loss|binomial_cdf|binomial_lccdf|binomial_lcdf|binomial_logit_lpmf|binomial_lpmf|binomial_rng|block|categorical_logit_lpmf|categorical_lpmf|categorical_rng|cauchy_cdf|cauchy_lccdf|cauchy_lcdf|cauchy_lpdf|cauchy_rng|cbrt|ceil|chi_square_cdf|chi_square_lccdf|chi_square_lcdf|chi_square_lpdf|chi_square_rng|cholesky_decompose|col|cols|columns_dot_product|columns_dot_self|cos|cosh|cov_exp_quad|crossprod|csr_extract_u|csr_extract_v|csr_extract_w|csr_matrix_times_vector|csr_to_dense_matrix|cumulative_sum|determinant|diag_matrix|diag_post_multiply|diag_pre_multiply|diagonal|digamma|dims|dirichlet_lpdf|dirichlet_rng|distance|dot_product|dot_self|double_exponential_cdf|double_exponential_lccdf|double_exponential_lcdf|double_exponential_lpdf|double_exponential_rng|e|eigenvalues_sym|eigenvectors_sym|erf|erfc|exp|exp2|exp_mod_normal_cdf|exp_mod_normal_lccdf|exp_mod_normal_lcdf|exp_mod_normal_lpdf|exp_mod_normal_rng|expm1|exponential_cdf|exponential_lccdf|exponential_lcdf|exponential_lpdf|exponential_rng|fabs|falling_factorial|fdim|floor|fma|fmax|fmin|fmod|frechet_cdf|frechet_lccdf|frechet_lcdf|frechet_lpdf|frechet_rng|gamma_cdf|gamma_lccdf|gamma_lcdf|gamma_lpdf|gamma_p|gamma_q|gamma_rng|gaussian_dlm_obs_lpdf|gumbel_cdf|gumbel_lccdf|gumbel_lcdf|gumbel_lpdf|gumbel_rng|head|hypergeometric_lpmf|hypergeometric_rng|hypot|inc_beta|int_step|integrate_ode_bdf|integrate_ode_rk45|inv|inv_chi_square_cdf|inv_chi_square_lccdf|inv_chi_square_lcdf|inv_chi_square_lpdf|inv_chi_square_rng|inv_cloglog|inv_gamma_cdf|inv_gamma_lccdf|inv_gamma_lcdf|inv_gamma_lpdf|inv_gamma_rng|inv_logit|inv_phi|inv_sqrt|inv_square|inv_wishart_lpdf|inv_wishart_rng|inverse|inverse_spd|is_inf|is_nan|lbeta|lchoose|lgamma|lkj_corr_cholesky_lpdf|lkj_corr_cholesky_rng|lkj_corr_lpdf|lkj_corr_rng|lmgamma|lmultiply|log|log10|log1m|log1m_exp|log1m_inv_logit|log1p|log1p_exp|log2|log_determinant|log_diff_exp|log_falling_factorial|log_inv_logit|log_mix|log_rising_factorial|log_softmax|log_sum_exp|logistic_cdf|logistic_lccdf|logistic_lcdf|logistic_lpdf|logistic_rng|logit|lognormal_cdf|lognormal_lccdf|lognormal_lcdf|lognormal_lpdf|lognormal_rng|machine_precision|max|mdivide_left_spd|mdivide_left_tri_low|mdivide_right_spd|mdivide_right_tri_low|mean|min|modified_bessel_first_kind|modified_bessel_second_kind|multi_gp_cholesky_lpdf|multi_gp_lpdf|multi_normal_cholesky_lpdf|multi_normal_cholesky_rng|multi_normal_lpdf|multi_normal_prec_lpdf|multi_normal_rng|multi_student_t_lpdf|multi_student_t_rng|multinomial_lpmf|multinomial_rng|multiply_lower_tri_self_transpose|neg_binomial_2_cdf|neg_binomial_2_lccdf|neg_binomial_2_lcdf|neg_binomial_2_log_lpmf|neg_binomial_2_log_rng|neg_binomial_2_lpmf|neg_binomial_2_rng|neg_binomial_cdf|neg_binomial_lccdf|neg_binomial_lcdf|neg_binomial_lpmf|neg_binomial_rng|negative_infinity|normal_cdf|normal_lccdf|normal_lcdf|normal_lpdf|normal_rng|not_a_number|num_elements|ordered_logistic_lpmf|ordered_logistic_rng|owens_t|pareto_cdf|pareto_lccdf|pareto_lcdf|pareto_lpdf|pareto_rng|pareto_type_2_cdf|pareto_type_2_lccdf|pareto_type_2_lcdf|pareto_type_2_lpdf|pareto_type_2_rng|pi|poisson_cdf|poisson_lccdf|poisson_lcdf|poisson_log_lpmf|poisson_log_rng|poisson_lpmf|poisson_rng|positive_infinity|pow|prod|qr_Q|qr_R|quad_form|quad_form_diag|quad_form_sym|rank|rayleigh_cdf|rayleigh_lccdf|rayleigh_lcdf|rayleigh_lpdf|rayleigh_rng|rep_array|rep_matrix|rep_row_vector|rep_vector|rising_factorial|round|row|rows|rows_dot_product|rows_dot_self|scaled_inv_chi_square_cdf|scaled_inv_chi_square_lccdf|scaled_inv_chi_square_lcdf|scaled_inv_chi_square_lpdf|scaled_inv_chi_square_rng|sd|segment|sin|singular_values|sinh|size|skew_normal_cdf|skew_normal_lccdf|skew_normal_lcdf|skew_normal_lpdf|skew_normal_rng|softmax|sort_asc|sort_desc|sort_indices_asc|sort_indices_desc|sqrt|sqrt2|square|squared_distance|step|student_t_cdf|student_t_lccdf|student_t_lcdf|student_t_lpdf|student_t_rng|sub_col|sub_row|sum|tail|tan|tanh|target|tcrossprod|tgamma|to_array_1d|to_array_2d|to_matrix|to_row_vector|to_vector|trace|trace_gen_quad_form|trace_quad_form|trigamma|trunc|uniform_cdf|uniform_lccdf|uniform_lcdf|uniform_lpdf|uniform_rng|variance|von_mises_lpdf|von_mises_rng|weibull_cdf|weibull_lccdf|weibull_lcdf|weibull_lpdf|weibull_rng|wiener_lpdf|wishart_lpdf|wishart_rng)\\b";
    var distributionList = "(~)(\\s*)(bernoulli|bernoulli_logit|beta|beta_binomial|binomial|binomial_logit|categorical|categorical_logit|cauchy|chi_square|dirichlet|double_exponential|exp_mod_normal|exponential|frechet|gamma|gaussian_dlm_obs|gumbel|hypergeometric|inv_chi_square|inv_gamma|inv_wishart|lkj_corr|lkj_corr_cholesky|logistic|lognormal|multi_gp|multi_gp_cholesky|multi_normal|multi_normal_cholesky|multi_normal_prec|multi_student_t|multinomial|neg_binomial|neg_binomial_2|neg_binomial_2_log|normal|ordered_logistic|pareto|pareto_type_2|poisson|poisson_log|rayleigh|scaled_inv_chi_square|skew_normal|student_t|uniform|von_mises|weibull|wiener|wishart)\\b";
    var deprecatedFunctionList = "\\b(bernoulli_ccdf_log|bernoulli_cdf_log|bernoulli_log|bernoulli_logit_log|beta_binomial_ccdf_log|beta_binomial_cdf_log|beta_binomial_log|beta_ccdf_log|beta_cdf_log|beta_log|binomial_ccdf_log|binomial_cdf_log|binomial_coefficient_log|binomial_log|binomial_logit_log|categorical_log|categorical_logit_log|cauchy_ccdf_log|cauchy_cdf_log|cauchy_log|chi_square_ccdf_log|chi_square_cdf_log|chi_square_log|dirichlet_log|double_exponential_ccdf_log|double_exponential_cdf_log|double_exponential_log|exp_mod_normal_ccdf_log|exp_mod_normal_cdf_log|exp_mod_normal_log|exponential_ccdf_log|exponential_cdf_log|exponential_log|frechet_ccdf_log|frechet_cdf_log|frechet_log|gamma_ccdf_log|gamma_cdf_log|gamma_log|gaussian_dlm_obs_log|get_lp|gumbel_ccdf_log|gumbel_cdf_log|gumbel_log|hypergeometric_log|increment_log_prob|integrate_ode|inv_chi_square_ccdf_log|inv_chi_square_cdf_log|inv_chi_square_log|inv_gamma_ccdf_log|inv_gamma_cdf_log|inv_gamma_log|inv_wishart_log|lkj_corr_cholesky_log|lkj_corr_log|logistic_ccdf_log|logistic_cdf_log|logistic_log|lognormal_ccdf_log|lognormal_cdf_log|lognormal_log|multi_gp_cholesky_log|multi_gp_log|multi_normal_cholesky_log|multi_normal_log|multi_normal_prec_log|multi_student_t_log|multinomial_log|multiply_log|neg_binomial_2_ccdf_log|neg_binomial_2_cdf_log|neg_binomial_2_log|neg_binomial_2_log_log|neg_binomial_ccdf_log|neg_binomial_cdf_log|neg_binomial_log|normal_ccdf_log|normal_cdf_log|normal_log|ordered_logistic_log|pareto_ccdf_log|pareto_cdf_log|pareto_log|pareto_type_2_ccdf_log|pareto_type_2_cdf_log|pareto_type_2_log|poisson_ccdf_log|poisson_cdf_log|poisson_log|poisson_log_log|rayleigh_ccdf_log|rayleigh_cdf_log|rayleigh_log|scaled_inv_chi_square_ccdf_log|scaled_inv_chi_square_cdf_log|scaled_inv_chi_square_log|skew_normal_ccdf_log|skew_normal_cdf_log|skew_normal_log|student_t_ccdf_log|student_t_cdf_log|student_t_log|uniform_ccdf_log|uniform_cdf_log|uniform_log|von_mises_log|weibull_ccdf_log|weibull_cdf_log|weibull_log|wiener_log|wishart_log)\\b";
    var reservedWords = "\\b(STAN_MAJOR|STAN_MATH_MAJOR|STAN_MATH_MINOR|STAN_MATH_PATCH|STAN_MINOR|STAN_PATCH|alignas|alignof|and|and_eq|asm|auto|bitand|bitor|bool|break|case|catch|char|char16_t|char32_t|class|compl|const|const_cast|constexpr|continue|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|false|float|for|friend|fvar|goto|if|in|inline|int|long|lp__|mutable|namespace|new|noexcept|not|not_eq|nullptr|operator|or|or_eq|private|protected|public|register|reinterpret_cast|repeat|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|then|this|thread_local|throw|true|try|typedef|typeid|typename|union|unsigned|until|using|var|virtual|void|volatile|wchar_t|while|xor|xor_eq)\\b";
    // ---

    this.$rules = {
      "start" : [
        {
          token : "comment.line.number-sign",
          regex : "\\/\\/.*$"
        },
        {
          token : "comment.line.double-dash",
          regex : "#.*$"
        },
        {
          token : "comment.block", // multi line comment
          regex : "\\/\\*",
          merge : true,
          next : "comment"
        },
        {
          // semantically this is closer to entity.name.type or entity.name.section
          // however the highlighting does not look good for those.
          token : "keyword.other.block",
          regex : "\\b(functions|data|transformed\\s+data|parameters|transformed\\s+parameters|model|generated\\s+quantities)\\b"
        },
        {
          // Stan is very strict on what characters it allows in strings
          // only allows the space character and any visible ASCII character
          // except the backslash \ and double quote " characters
          // needs to be a single line
          token : "string.quoted.double",
          regex : '["][ a-zA-Z0-9~@#$%^&*_\'`\\-+={}[\\]()<>|/!?.,;:]*["]'
        },
        {
           token : "constant.numeric", // number + integer
           regex : "(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eE][+\\-]?\\d*)?\\b"
        },
        {
          // truncation. This needs to go before identifiers
          token : "keyword.operator",
          regex : "\\bT(?=\\s*\\[)"
        },
        {
          token : ["keyword.other", "text", "punctuation"],
          regex : "(lower|upper)(\\s*)(=)"
        },
        {
          // target +=
          // needs to go before identifiers.
          // highlight target() as a standard function
          token: ["keyword.other", "text", "keyword.operator"],
          regex: "(target)(\\s*)(\\+=)"
        },
        {
          token : "keyword.control",
          regex : keywordsControl
        },
        {
          token : "keyword.other",
          regex : keywordFunctions
        },
        {
          token : "storage.type",
          regex : storageTypes
        },
        {
          token : "invalid.deprecated",
          regex : deprecatedFunctionList
        },
        {
          token : ["keyword.operator.sampling", "text", "support.function"],
          regex : distributionList
        },
        {
          token : "support.function",
          regex : functionList
        },
        {
          token : "invalid.illegal",
          regex : reservedWords
        },
        {
          // invalid variable names ending in __
          token : "invalid.illegal",
          regex : variableName + "__\\b"
        },
        {
          // invalid variable names
          // must follow constant.numeric so 1e9 won't get selected.
          token : "invalid.illegal",
          regex : "\\b(?:_|[_0-9][A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_]*__)\\b"
        },
        {
          // R highlight indicates functions vs. normal identifiers
          token : "function",
          regex : variableName + "(?=\\s*\\()"
        },
        {
          token : "identifier",
          regex : variableName
        },
        {
          token : "invalid.deprecated",
          regex : "<-"
        },
        {
          // this includes the = assignment operator
          // although : is part of both range slices and ternary operator, it is
          // always highlighted as an operator.
          token : "keyword.operator",
          regex : "~|[|]{2}|&&|==?|!=|<=?|>=?|\\+|-|\\.?\\*|\\.?/|\\\\|\\^|!|'|%|\\?|:"
        },
        {
          token : "punctuation.operator",
          regex : ",|;|[|]"
        },
        {
          // neither keywords nor operators, but this makes them visually distinct
          token : "paren.lparen.keyword.operator",
          regex : "[\\[\\(\\{]"
        },
        {
          // neither keywords nor operators, but this makes them visually distinct
          token : "paren.rparen.keyword.operator",
          regex : "[\\]\\)\\}]"
        },
        {
          token : "text",
          regex : "\\s+"
        }
      ],
      "comment" : [
        {
          token : "comment", // closing comment
          regex : ".*?\\*\\/",
          next : "start"
        },
        {
          token : "comment", // comment spanning whole line
          merge : true,
          regex : ".+"
        }
      ]
    };
  };

  oop.inherits(StanHighlightRules, TextHighlightRules);

  exports.StanHighlightRules = StanHighlightRules;
});
/*
 * sweave.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/sweave", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var SweaveHighlightRules = require("mode/sweave_highlight_rules").SweaveHighlightRules;
var RCodeModel = require("mode/r_code_model").RCodeModel;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;
var RMatchingBraceOutdent = require("mode/r_matching_brace_outdent").RMatchingBraceOutdent;
var unicode = require("ace/unicode");
var Utils = require("mode/utils");
var AutoBraceInsert = require("mode/auto_brace_insert").AutoBraceInsert;

var Mode = function(suppressHighlighting, session) {
   if (suppressHighlighting)
      this.$tokenizer = new Tokenizer(new TextHighlightRules().getRules());
   else
      this.$tokenizer = new Tokenizer(new SweaveHighlightRules().getRules());

   this.$session = session;
   this.$outdent = new MatchingBraceOutdent();

   this.codeModel = new RCodeModel(
      session,
      this.$tokenizer,
      /^r-/,
      /<<(.*?)>>/,
      /^\s*@\s*$/
   );
   this.$r_outdent = new RMatchingBraceOutdent(this.codeModel);

   this.foldingRules = this.codeModel;
};
oop.inherits(Mode, TextMode);

(function() {

   this.tokenRe = new RegExp("^[" + unicode.wordChars + "._]+", "g");
   this.nonTokenRe = new RegExp("^(?:[^" + unicode.wordChars + "._]|\\s)+", "g");

   this.$complements = {
            "(": ")",
            "[": "]",
            '"': '"',
            "'": "'",
            "{": "}"
         };
   this.$reOpen = /^[(["'{]$/;
   this.$reClose = /^[)\]"'}]$/;

   this.insertChunkInfo = {
      value: "<<>>=\n\n@\n",
      position: {row: 0, column: 2}, 
      content_position: {row: 1, column: 0}
   };

   this.getLanguageMode = function(position)
   {
      var state = Utils.getPrimaryState(this.$session, position.row);
      return state.match(/^r-/) ? 'R' : 'TeX';
   };

   this.$getNextLineIndent = this.getNextLineIndent;
   this.getNextLineIndent = function(state, line, tab, row)
   {
      var mode = Utils.activeMode(state, "tex");
      if (mode === "r")
         return this.codeModel.getNextLineIndent(state, line, tab, row);
      else
         return this.$getNextLineIndent(state, line, tab);
   };

   this.checkOutdent = function(state, line, input)
   {
      var mode = Utils.activeMode(state, "tex");
      if (mode === "r")
         return this.$r_outdent.checkOutdent(state, line, input);
      else
         return this.$outdent.checkOutdent(line, input);
   };

   this.autoOutdent = function(state, session, row)
   {
      var mode = Utils.activeMode(state, "tex");
      if (mode === "r")
         return this.$r_outdent.autoOutdent(state, session, row);
      else
         return this.$outdent.autoOutdent(session, row);
   };

   this.allowAutoInsert = this.smartAllowAutoInsert;

   this.$id = "mode/sweave";

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * sweave_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/sweave_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Utils = require("mode/utils");

var TexHighlightRules = require("mode/tex_highlight_rules").TexHighlightRules;
var RHighlightRules = require("mode/r_highlight_rules").RHighlightRules;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var SweaveHighlightRules = function() {

    // regexp must not have capturing parentheses
    // regexps are ordered -> the first match is used

    // Use TeX highlight rules as a base
    this.$rules = new TexHighlightRules().getRules();

    // Embed R highlight rules
    this.addRules(new RHighlightRules().getRules(), "r-");          // Sweave code chunks
    this.addRules(new RHighlightRules().getRules(), "r-sexpr-");    // \Sexpr{}


    // enter an R code chunk
    this.$rules["start"].unshift({
        token: "comment.codebegin",
        regex: "^\\s*<<.*>>=.*$",
        next: "r-start"
    });

    // exit an R code chunk
    this.$rules["r-start"].unshift({
        token: "comment.codeend",
        regex: "^\\s*@(?:\\s.*)?$",
        next: "start"
    });

    // Sweave comments start with an '@'
    this.$rules["start"].unshift({
        token: "comment",
        regex: "^\\s*@(?:\\s.*)?$"
    });

    // embed R highlight rules within \Sexpr{}
    this.$rules["start"].unshift({
        regex: "(\\\\Sexpr)([{])",
        next: "r-sexpr-start",
        onMatch: function(value, state, stack, line, context) {
            context.sexpr = context.sexpr || {};
            context.sexpr.state = state;
            context.sexpr.count = 1;
            return [
                { type: "keyword", value: "\\Sexpr" },
                { type: "paren.keyword.operator", value: "{" }
            ];
        }
    });

    // special handling for '{' and '}', for Sexpr embeds
    this.$rules["r-sexpr-start"].unshift({
        token : "paren.keyword.operator",
        regex : "[{]",
        merge : false,
        onMatch: function(value, state, stack, line, context) {
            context.sexpr.count += 1;
            return this.token;
        }
    });

    this.$rules["r-sexpr-start"].unshift({
        token : "paren.keyword.operator",
        regex : "[}]",
        merge : false,
        onMatch: function(value, state, stack, line, context) {
            context.sexpr.count -= 1;
            if (context.sexpr.count === 0) {
                this.next = context.sexpr.state;
                delete context.sexpr;
            } else {
                this.next = state;
            }
            return this.token;
        }
    });

};

oop.inherits(SweaveHighlightRules, TextHighlightRules);

exports.SweaveHighlightRules = SweaveHighlightRules;
});
/*
 * tex.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/tex", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
var TexHighlightRules = require("mode/tex_highlight_rules").TexHighlightRules;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;

var Mode = function(suppressHighlighting) {
	if (suppressHighlighting)
    	this.$tokenizer = new Tokenizer(new TextHighlightRules().getRules());
	else
    	this.$tokenizer = new Tokenizer(new TexHighlightRules().getRules());
    this.$outdent = new MatchingBraceOutdent();
};
oop.inherits(Mode, TextMode);

(function() {
   this.getNextLineIndent = function(state, line, tab) {
      return this.$getIndent(line);
   };

   this.allowAutoInsert = function() {
      return false;
   };
}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * tex_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("mode/tex_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var TexHighlightRules = function(textClass) {

    if (!textClass)
        textClass = "text";

    // regexp must not have capturing parentheses. Use (?:) instead.
    // regexps are ordered -> the first match is used

    this.$rules = {
        "start" : [
	        {
	            token : "comment",
	            regex : "%.*$"
	        }, {
	            token : textClass, // non-command
	            regex : "\\\\[$&%#\\{\\}]"
	        }, {
	            token : "keyword", // command
	            regex : "\\\\(?:documentclass|usepackage|newcounter|setcounter|addtocounter|value|arabic|stepcounter|newenvironment|renewenvironment|ref|vref|eqref|pageref|label|cite[a-zA-Z]*|tag|begin|end|bibitem)\\b",
               push : "nospell"
	        }, {
	            token : "keyword", // command
	            regex : "\\\\(?:[a-zA-Z0-9]+|[^a-zA-Z0-9])"
	        }, {
               // Obviously these are neither keywords nor operators, but
               // labelling them as such was the easiest way to get them
               // to be colored distinctly from regular text
               token : "paren.keyword.operator",
	            regex : "[[({]"
	        }, {
               // Obviously these are neither keywords nor operators, but
               // labelling them as such was the easiest way to get them
               // to be colored distinctly from regular text
               token : "paren.keyword.operator",
	            regex : "[\\])}]"
	        }, {
	            token : textClass,
	            regex : "\\s+"
	        }
        ],
        // This mode is necessary to prevent spell checking, but to keep the
        // same syntax highlighting behavior. The list of commands comes from
        // Texlipse.
        "nospell" : [
           {
               token : "comment",
               regex : "%.*$",
               next  : "pop"
           }, {
               token : "nospell." + textClass, // non-command
               regex : "\\\\[$&%#\\{\\}]"
           }, {
               token : "keyword", // command
               regex : "\\\\(?:documentclass|usepackage|newcounter|setcounter|addtocounter|value|arabic|stepcounter|newenvironment|renewenvironment|ref|vref|eqref|pageref|label|cite[a-zA-Z]*|tag|begin|end|bibitem)\\b"
           }, {
               token : "keyword", // command
               regex : "\\\\(?:[a-zA-Z0-9]+|[^a-zA-Z0-9])",
               next  : "pop"
           }, {
               token : "paren.keyword.operator",
               regex : "[[({]"
           }, {
               token : "paren.keyword.operator",
               regex : "[\\])]"
           }, {
               token : "paren.keyword.operator",
               regex : "}",
               next  : "pop"
           }, {
               token : "nospell." + textClass,
               regex : "\\s+"
           }, {
               token : "nospell." + textClass,
               regex : "\\w+"
           }
        ]
    };

    this.normalizeRules();
};

oop.inherits(TexHighlightRules, TextHighlightRules);

exports.TexHighlightRules = exports.LatexHighlightRules = TexHighlightRules;
});
/*
 * token_cursor.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/token_cursor", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Utils = require("mode/utils");

var $reParenType = Utils.getTokenTypeRegex("paren");

var TokenCursor = function(tokens, row, offset) {

   this.$tokens = tokens;
   this.$row = row || 0;
   this.$offset = offset || 0;

};

(function () {

   this.cloneCursor = function()
   {
      return new TokenCursor(
         this.$tokens,
         this.$row,
         this.$offset
      );
   };

   var isArray = Utils.isArray;
   var contains = Utils.contains;
   var construct = Utils.construct;

   var $complements = {
      "(" : ")",
      "{" : "}",
      "<" : ">",
      "[" : "]",
      ")" : "(",
      "}" : "{",
      ">" : "<",
      "]" : "["
   };

   var $leftBrackets  = ["(", "[", "{"];
   var $rightBrackets = [")", "]", "}"];

   this.moveToStartOfRow = function(row)
   {
      this.$row = row;
      this.$offset = 0;
   };

   this.moveToEndOfRow = function(row)
   {
      this.$row = row;
      var tokens = this.$tokens[row];
      if (tokens && tokens.length)
         this.$offset = tokens.length - 1;
      else
         this.$offset = 0;
   }

   // Move the cursor to the previous token. Returns true (and moves the
   // the cursor) on success; returns false (and does not move the cursor)
   // on failure.
   this.moveToPreviousToken = function()
   {
      // Bail if we're at the start of the document (protect against
      // invalid token cursors)
      if (this.$row <= 0 && this.$offset <= 0)
      {
         this.$row = 0;
         this.$offset = 0;
         return false;
      }

      // If the offset is greater than zero, we know we can safely
      // decrement it
      if (this.$offset > 0)
      {
         this.$offset--;
         return true;
      }

      // Otherwise, we keep walking back until we find a row containing
      // at least one token
      var row = this.$row - 1;
      var length = 0;
      while (row >= 0)
      {
         // Check to see if we have any tokens on this line --
         // if we do, accept that
         var rowTokens = this.$tokens[row];
         if (rowTokens && rowTokens.length !== 0)
         {
            length = rowTokens.length;
            break;
         }
         
         row--;
      }

      // If we reached a negative row, we failed (we were actually on
      // the first token)
      if (row < 0)
         return false;

      // Otherwise, we can set the row + offset and return true
      this.$row = row;
      this.$offset = length - 1;
      return true;
   };

   // Move the cursor to the next token. Returns true (and moves the
   // the cursor) on success; returns false (and does not move the cursor)
   // on failure.
   this.moveToNextToken = function(maxRow)
   {
      // If maxRow is undefined, we'll iterate up to the length of
      // the tokens array
      if (typeof maxRow === "undefined")
         maxRow = (this.$tokens || []).length;

      // If we're already past the maxRow bound, fail
      if (this.$row > maxRow)
         return false;

      // Tokenize ahead, if appropriate
      if (this.$tokens[this.$row] == null)
      {
         if (this.$codeModel &&
             this.$codeModel.$tokenizeUpToRow)
         {
            this.$codeModel.$tokenizeUpToRow.call(this.$codeModel, maxRow);
         }
      }

      // If the number of tokens on the current row is greater than
      // the offset, we can just increment and return true
      var rowTokens = this.$tokens[this.$row];
      if (rowTokens &&
          this.$offset < rowTokens.length - 1)
      {
         this.$offset++;
         return true;
      }

      // Otherwise, we walk up rows until we find the first row
      // containing a token. Note that we may need to check for
      // invalidated rows (ie, rows that are null rather than having
      // an empty array
      var row = this.$row + 1;
      while (row <= maxRow)
      {
         rowTokens = this.$tokens[row];
         if (rowTokens && rowTokens.length !== 0)
            break;
         row++;
      }

      if (row > maxRow)
         return false;

      this.$row = row;
      this.$offset = 0;
      return true;
      
   };
   
   this.peekBwd = function(n) {
      
      if (typeof n === "undefined") {
         n = 1;
      }
      
      var clone = this.cloneCursor();
      for (var i = 0; i < n; i++) {
         if (!clone.moveToPreviousToken()) {
            return clone.$invalidate();
         }
      }
      return clone;
   };

   this.peekFwd = function(n) {
      
      if (typeof n === "undefined") {
         n = 1;
      }
      
      var clone = this.cloneCursor();
      for (var i = 0; i < n; i++) {
         if (!clone.moveToNextToken()) {
            return clone.$invalidate();
         }
      }
      return clone;
   };

   this.$invalidate = function() {
      this.$row = 0;
      this.$column = 0;
      this.$tokens = [];
      return this;
   };

   this.seekToNearestToken = function(position, maxRow)
   {
      if (position.row > maxRow)
         return false;

      this.$row = position.row;
      var rowTokens = this.$tokens[this.$row] || [];
      for (this.$offset = 0; this.$offset < rowTokens.length; this.$offset++)
      {
         var token = rowTokens[this.$offset];
         if (token.column >= position.column)
         {
            return true;
         }
      }

      if (position.row < maxRow) {
         return this.moveToNextToken(maxRow);
      } else {
         return false;
      }
      
   };

   this.bwdToNearestToken = function(position)
   {
      this.$row = position.row;
      this.$offset = position.column;
      
      var rowTokens = this.$tokens[this.$row] || [];
      for (; this.$offset >= 0; this.$offset--)
      {
         var token = rowTokens[this.$offset];
         if (typeof token !== "undefined" && (token.column <= position.column))
         {
            return true;
         }
      }
      return this.moveToPreviousToken();
   };

   

   this.bwdToMatchingToken = function() {

      var thisValue = this.currentValue();
      if (!contains($rightBrackets, thisValue))
         return false;
      
      var compValue = $complements[thisValue];
      
      var success = false;
      var parenCount = 0;
      
      while (this.moveToPreviousToken())
      {
         var currentValue = this.currentValue();
         if (currentValue === compValue)
         {
            if (parenCount === 0)
            {
               return true;
            }
            parenCount--;
         }
         else if (currentValue === thisValue)
         {
            parenCount++;
         }
      }

      return false;
      
   };

   this.fwdToMatchingToken = function() {

      var thisValue = this.currentValue();
      if (!contains($leftBrackets, thisValue))
         return false;
      
      var compValue = $complements[thisValue];

      var success = false;
      var parenCount = 0;
      while (this.moveToNextToken())
      {
         var currentValue = this.currentValue();
         if (currentValue === compValue)
         {
            if (parenCount === 0)
            {
               return true;
            }
            parenCount--;
         }
         else if (currentValue === thisValue)
         {
            parenCount++;
         }
      }

      return false;
      
   };

   this.equals = function(other) {
      return this.$row === other.$row && this.$offset === other.$offset;
   };

   this.moveBackwardOverMatchingParens = function()
   {
      if (!this.moveToPreviousToken())
         return false;
      
      if (this.currentValue() !== ")") {
         this.moveToNextToken();
         return false;
      }

      var success = false;
      var parenCount = 0;
      while (this.moveToPreviousToken())
      {
         var currentValue = this.currentValue();
         if (currentValue === "(")
         {
            if (parenCount === 0)
            {
               success = true;
               break;
            }
            parenCount--;
         }
         else if (currentValue === ")")
         {
            parenCount++;
         }
      }
      return success;
   };

   this.findToken = function(predicate, maxRow)
   {
      do
      {
         var t = this.currentToken();
         if (t && predicate(t))
            return t;
      }
      while (this.moveToNextToken(maxRow));
      return null;
   };

   this.findTokenBwd = function(predicate, maxRow)
   {
      do
      {
         var t = this.currentToken();
         if (t && predicate(t))
            return t;
      }
      while (this.moveToPreviousToken(maxRow));
      return null;
   };

   this.currentToken = function()
   {
      var rowTokens = this.$tokens[this.$row];
      if (rowTokens == null)
         return {};

      var token = rowTokens[this.$offset];
      if (token == null)
         return {};

      return token;
   };

   this.currentValue = function()
   {
      return this.currentToken().value;
   };

   this.currentType = function()
   {
      return this.currentToken().type;
   };

   this.hasType = function(/*...*/)
   {
      var tokenType = this.currentType();
      if (tokenType == null)
         return false;

      for (var i = 0; i < arguments.length; i++) {
         var type = arguments[i];
         if (tokenType === type ||
             tokenType.indexOf(type + ".") !== -1 ||
             tokenType.indexOf("." + type) !== -1)
         {
            return true;
         }
      }
      return false;
   };

   this.currentPosition = function()
   {
      var token = this.currentToken();
      if (token == null)
         return null;
      else
         return {row: this.$row, column: token.column};
   };

   this.isFirstSignificantTokenOnLine = function()
   {
      return this.$offset === 0;
   };

   this.isLastSignificantTokenOnLine = function()
   {
      return this.$offset == (this.$tokens[this.$row] || []).length - 1;
   };

   this.bwdUntil = function(predicate) {
      while (!predicate(this)) {
         this.moveToPreviousToken();
      }
   };

   this.bwdWhile = function(predicate) {
      while (predicate(this)) {
         this.moveToPreviousToken();
      }
   };

   // Move a token cursor to a document position. This essentially
   // involves translating a '{row, column}' document position to a
   // '{row, offset}' position for a token cursor. Note that this
   // function _excludes_ the token directly at the cursor
   // position by default, e.g.
   //
   //     foo[a, b|]
   //            ^
   // Note that the cursor is 'on' the ']' above, but we intend to
   // move it onto the 'b' token instead. This is the more common
   // action throughout the code model and hence why it is the
   // default. (The intention is that only tokens immediately
   // preceding the cursor should affect indentation choices, and
   // so we should exclude anything on, or after, the cursor
   // itself)
   this.moveToPosition = function(pos, rightInclusive) {

      var row = pos.row;
      var column = pos.column;
      
      var rowTokens = this.$tokens[row];

      // Ensure that we have tokenized up to the current position,
      // if a code model is available.
      if (rowTokens == null &&
          this.$codeModel &&
          this.$codeModel.$tokenizeUpToRow)
      {
         this.$codeModel.$tokenizeUpToRow.call(this.$codeModel, row);
         rowTokens = this.$tokens[row];
      }

      // If there are tokens on this row, we can move to the first token
      // on that line before the cursor position.
      //
      // Note that we validate that there is at least one token
      // left of, or at, of the cursor position before entering
      // this block.
      if (rowTokens && rowTokens.length > 0 && rowTokens[0].column <= column)
      {
         // We want to find the index of the largest token column still less than
         // the column passed in by the caller.
         var index = 0;
         for (; index < rowTokens.length; index++)
         {
            if (rowTokens[index].column >= column)
            {
               break;
            }
         }

         this.$row = row;

         // It's possible for us to go too far, if the column passed
         // in is too large. In that case, we still want to move to the
         // final token on the line.
         if (index === rowTokens.length)
            this.$offset = index - 1;
         else if (rightInclusive && rowTokens[index].column === column)
            this.$offset = index;
         else
            this.$offset = index - 1;
         
         return true;
      }

      // Otherwise, we just move to the first token previous to this line.
      // Clone the cursor, put that cursor at the start of the row, and try
      // to find the previous token.
      var clone = this.cloneCursor();
      clone.$row = row;
      clone.$offset = 0;
      
      if (clone.moveToPreviousToken())
      {
         this.$row = clone.$row;
         this.$offset = clone.$offset;
         return true;
      }

      return false;
   };

   // Walk backwards to find an opening bracket (in the array 'tokens').
   // If 'failOnOpenBrace' is true and we encounter a '{', we give up and return
   // false.
   this.findOpeningBracket = function(tokens, failOnOpenBrace)
   {
      // 'tokens' can be passed in either as a single token, or
      // an array of tokens. If we don't have an array, convert it
      // to one.
      if (!isArray(tokens))
         tokens = [tokens];
      
      var clone = this.cloneCursor();

      do
      {
         if (clone.bwdToMatchingToken())
            continue;
         
         var currentValue = clone.currentValue();
         
         if (failOnOpenBrace && currentValue === "{")
            return false;

         for (var i = 0; i < tokens.length; i++)
         {
            if (currentValue === tokens[i])
            {
               this.$row = clone.$row;
               this.$offset = clone.$offset;
               return true;
            }
         }

      } while (clone.moveToPreviousToken());

      return false;
      
   };

   this.findOpeningBracketCountCommas = function(tokens, failOnOpenBrace)
   {
      if (!isArray(tokens))
         tokens = [tokens];
      
      var clone = this.cloneCursor();
      var commaCount = 0;
      
      do
      {
         if (clone.bwdToMatchingToken())
            continue;
         
         var currentValue = clone.currentValue();
         
         if (currentValue === ",")
            commaCount += 1;

         if (failOnOpenBrace && currentValue === "{")
            return -1;

         for (var i = 0; i < tokens.length; i++)
         {
            if (currentValue === tokens[i])
            {
               this.$row = clone.$row;
               this.$offset = clone.$offset;
               return commaCount;
            }
         }
         
      } while (clone.moveToPreviousToken());
      
      return -1;
   };

}).call(TokenCursor.prototype);


var CppTokenCursor = function(tokens, row, offset, codeModel) {
   this.$tokens = tokens;
   this.$row = row || 0;
   this.$offset = offset || 0;
   this.$codeModel = codeModel;
};
oop.mixin(CppTokenCursor.prototype, TokenCursor.prototype);

(function() {

   this.cloneCursor = function()
   {
      return new CppTokenCursor(
         this.$tokens,
         this.$row,
         this.$offset,
         this.$codeModel
      );
   };

   var contains = Utils.contains;

   // Move the tokne cursor backwards from an open brace over const, noexcept,
   // for function definitions.
   //
   // E.g.
   //
   //     int foo(int a) const noexcept(...) {
   //                    ^~~~~~~~~~~~~~~~~~~~^
   //
   // Places the token cursor on the first token following a closing paren.
   this.bwdOverConstNoexceptDecltype = function() {

      var clone = this.cloneCursor();
      if (clone.currentValue() !== "{") {
         return false;
      }

      // Move off of the open brace
      if (!clone.moveToPreviousToken())
         return false;

      // Try moving over a '-> decltype()'
      var cloneDecltype = clone.cloneCursor();
      if (cloneDecltype.currentValue() === ")") {
         if (cloneDecltype.bwdToMatchingToken()) {
            if (cloneDecltype.moveToPreviousToken()) {
               if (cloneDecltype.currentValue() === "decltype") {
                  if (cloneDecltype.moveToPreviousToken()) {
                     clone.$row = cloneDecltype.$row;
                     clone.$offset = cloneDecltype.$offset;
                  }
               }
            }
         }
      }
      
      // Try moving over a 'noexcept()'.
      var cloneNoexcept = clone.cloneCursor();
      if (cloneNoexcept.currentValue() === ")") {
         if (cloneNoexcept.bwdToMatchingToken()) {
            if (cloneNoexcept.moveToPreviousToken()) {
               if (cloneNoexcept.currentValue() === "noexcept") {
                  clone.$row = cloneNoexcept.$row;
                  clone.$offset = cloneNoexcept.$offset;
               }
            }
         }
      }

      // Try moving over a 'noexcept'.
      if (clone.currentValue() === "noexcept")
         if (!clone.moveToPreviousToken())
            return false;

      // Try moving over the 'const'
      if (clone.currentValue() === "const")
         if (!clone.moveToPreviousToken())
            return false;

      // Move back up one if we landed on the closing paren
      if (clone.currentValue() === ")")
         if (!clone.moveToNextToken())
            return false;

      this.$row = clone.$row;
      this.$offset = clone.$offset;
      return true;

   };

   this.bwdToMatchingArrow = function() {

      var thisValue = ">";
      var compValue = "<";

      if (this.currentValue() !== ">") return false;

      var success = false;
      var parenCount = 0;
      var clone = this.cloneCursor();
      while (clone.moveToPreviousToken())
      {
         if (clone.currentValue() === compValue)
         {
            if (parenCount === 0)
            {
               this.$row = clone.$row;
               this.$offset = clone.$offset;
               return true;
            }
            parenCount--;
         }
         else if (clone.currentValue() === thisValue)
         {
            parenCount++;
         }
      }

      return false;
      
   };

   // Move over a 'classy' specifier, e.g.
   //
   //     ::foo::bar<A, T>::baz<T>::bat
   //
   // This amounts to moving over identifiers, keywords and matching arrows.
   this.bwdOverClassySpecifiers = function() {

      var startValue = this.currentValue();
      if (startValue === ":" ||
          startValue === "," ||
          startValue === "{")
      {
         this.moveToPreviousToken();
      }

      do
      {
         if (this.bwdToMatchingArrow())
            this.moveToPreviousToken();

         var type = this.currentType();
         var value = this.currentValue();

         if (!(
            type === "keyword" ||
               value === "::" ||
               type === "identifier" ||
               type === "constant"
         ))
         {
            break;
         }

         if (value === "class" ||
             value === "struct" ||
             value === "enum" ||
             value === ":" ||
             value === ",")
         {
            return true;
         }
         
      } while (this.moveToPreviousToken());

      return false;

   };

   // Move backwards over class inheritance.
   //
   // This moves the cursor backwards over any inheritting classes,
   // e.g.
   //
   //     class Foo :
   //         public A,
   //         public B {
   //
   // The cursor is expected to start on the opening brace, and will
   // end on the opening ':' on success.
   this.bwdOverClassInheritance = function() {

      var clonedCursor = this.cloneCursor();
      return doBwdOverClassInheritance(clonedCursor, this);

   };

   var doBwdOverClassInheritance = function(clonedCursor, tokenCursor) {

      clonedCursor.bwdOverClassySpecifiers();

      // Check for a ':' or a ','
      var value = clonedCursor.currentValue();
      if (value === ",") {
         return doBwdOverClassInheritance(clonedCursor, tokenCursor);
      } else if (value === ":") {
         tokenCursor.$row = clonedCursor.$row;
         tokenCursor.$offset = clonedCursor.$offset;
         return true;
      }            

      return false;
      
   };

   // Move backwards over an initialization list, e.g.
   //
   //     Foo : a_(a),
   //           b_(b),
   //           c_(c) const noexcept() {
   //
   // The assumption is that the cursor starts on an opening brace.
   this.bwdOverInitializationList = function() {

      var clonedCursor = this.cloneCursor();
      return this.doBwdOverInitializationList(clonedCursor, this);

   };

   this.doBwdOverInitializationList = function(clonedCursor, tokenCursor) {

      // Move over matching parentheses -- note that this action puts
      // the cursor on the open paren on success.
      clonedCursor.moveBackwardOverMatchingParens();
      if (!clonedCursor.moveBackwardOverMatchingParens()) {
         if (!clonedCursor.moveToPreviousToken()) {
            return false;
         }
      }

      // Chomp keywords
      while (clonedCursor.currentType() === "keyword")
         if (!clonedCursor.moveToPreviousToken())
            return false;
      
      // Move backwards over the name of the element initialized
      if (clonedCursor.moveToPreviousToken()) {

         // Check for a ':' or a ','
         var value = clonedCursor.currentValue();
         if (value === ",") {
            return this.doBwdOverInitializationList(clonedCursor, tokenCursor);
         } else if (value === ":") {
            var prevValue = clonedCursor.peekBwd().currentValue();
            if (!contains(
               ["public", "private", "protected"],
               prevValue
            ))
            {
               tokenCursor.$row = clonedCursor.$row;
               tokenCursor.$offset = clonedCursor.$offset;
               return true;
            }
         }
      }

      return false;

   };
   
}).call(CppTokenCursor.prototype);

var RTokenCursor = function(tokens, row, offset, codeModel) {
   this.$tokens = tokens;
   this.$row = row || 0;
   this.$offset = offset || 0;
   this.$codeModel = codeModel;
};
oop.mixin(RTokenCursor.prototype, TokenCursor.prototype);

(function() {

   this.cloneCursor = function()
   {
      return new RTokenCursor(
         this.$tokens,
         this.$row,
         this.$offset,
         this.$codeModel
      );
   };

   var contains = Utils.contains;

   this.isValidAsIdentifier = function()
   {
      var type = this.currentType();
      return this.hasType("identifier", "constant") ||
             type === "symbol" ||
             type === "keyword" ||
             type === "string";
   };

   this.isExtractionOperator = function()
   {
      var value = this.currentValue();
      return value === "$" ||
             value === "@" ||
             value === "::" ||
             value === ":::";
   };

   // Find the start of the evaluation context for a generic expression,
   // e.g.
   //
   //     x[[1]]$foo[[1]][, 2]@bar[[1]]()
   //     ^~~~~~~~~~~~<~~~~~~~~~~~~~~~~~^
   this.findStartOfEvaluationContext = function() {
      
      var clone = this.cloneCursor();
      
      do
      {
         if (clone.bwdToMatchingToken())
            continue;
         
         // If we land on an identifier, we keep going if the token previous is
         // 'infix-y', and bail otherwise.
         if (clone.isValidAsIdentifier())
         {
            if (!clone.moveToPreviousToken())
               break;

            if (clone.isExtractionOperator())
               continue;
            
            if (!clone.moveToNextToken())
               return false;
            
            break;
            
         }

         // Fail if we get here as it implies we hit something not permissible
         // for the evaluation context
         return false;
         
      } while (clone.moveToPreviousToken());

      this.$row = clone.$row;
      this.$offset = clone.$offset;
      return true;
      
   };

   this.isLookingAtBinaryOp = function()
   {
      var type = this.currentType();
      return type === "keyword.operator" ||
             type === "keyword.operator.infix";
   };

   this.moveToStartOfCurrentStatement = function()
   {
      var clone = this.cloneCursor();
      while (clone.isLookingAtBinaryOp())
         if (!clone.moveToPreviousToken())
            return false;

      do
      {
         if (clone.bwdToMatchingToken())
            continue;
         
         // If we land on an identifier, we keep going if the token previous is
         // 'infix-y', and bail otherwise.
         if (clone.isValidAsIdentifier())
         {
            if (!clone.moveToPreviousToken())
               break;

            if (clone.isLookingAtBinaryOp())
            {
               while (clone.isLookingAtBinaryOp())
                  if (!clone.moveToPreviousToken())
                     return false;

               // Move back up one because the loop condition will take us back again
               if (!clone.moveToNextToken())
                  return false;

               continue;
            }
            
            if (!clone.moveToNextToken())
               return false;
            
            break;
            
         }

         // Fail if we get here as it implies we hit something not permissible
         // for the evaluation context
         return false;
         
      } while (clone.moveToPreviousToken());

      this.$row = clone.$row;
      this.$offset = clone.$offset;
      return true;
   };

   this.moveToEndOfCurrentStatement = function()
   {
      var clone = this.cloneCursor();
      while (clone.isLookingAtBinaryOp())
         if (!clone.moveToNextToken())
            return false;

      do
      {
         if (clone.fwdToMatchingToken())
            continue;

         if (clone.isValidAsIdentifier())
         {
            if (!clone.moveToNextToken())
               break;

            if (clone.isLookingAtBinaryOp())
            {
               while (clone.isLookingAtBinaryOp())
                  if (!clone.moveToNextToken())
                     return false;

               if (!clone.moveToPreviousToken())
                  return false;

               continue;
            }

            if (!clone.moveToPreviousToken())
               return false;

            break;
         }

         return false;
      } while (clone.moveToNextToken());

      this.$row = clone.$row;
      this.$offset = clone.$offset;
      return true;
   };

   function isSingleLineString(value)
   {
      if (value.indexOf("'") === 0)
         return value.lastIndexOf("'") === value.length - 1;
      else if (value.indexOf('"') === 0)
         return value.lastIndexOf('"') === value.length - 1;

      return false;
   }
   
   this.isSingleLineString = function()
   {
      return isSingleLineString(this.currentValue());
   };

   function isLeftBracket(bracket)
   {
      return bracket === '(' ||
             bracket === '[' ||
             bracket === '{';
   }

   this.isLeftBracket = function()
   {
      return isLeftBracket(this.currentValue());
   };

   function isRightBracket(bracket)
   {
      return bracket === ')' ||
             bracket === ']' ||
             bracket === '}';
   }

   this.isRightBracket = function()
   {
      return isRightBracket(this.currentValue());
   };

   // NOTE: A lot of the ugliness here stems from the fact that
   // both open and closing brackets have the same type; that is,
   //
   //    paren.***
   //
   this.isValidForEndOfStatement = function()
   {
      var type = this.currentType();
      var value = this.currentValue();

      if (type.search($reParenType) !== -1)
         return isRightBracket(value);

      return isSingleLineString(value) ||
             this.hasType("identifier", "constant", "variable");
   };

   this.isValidForStartOfStatement = function()
   {
      var type = this.currentType();
      var value = this.currentValue();

      if (type.search($reParenType) !== -1)
         return isLeftBracket(this.currentValue());

      var value = this.currentValue();
      return isSingleLineString(value) ||
             this.hasType("identifier", "constant", "variable");
   };

   // NOTE: By 'conditional' we mean following by a parenthetical
   // expression of some form
   this.isConditionalControlFlowKeyword = function()
   {
      var value = this.currentValue();
      return contains(
         ["if", "for", "while", "function"],
         value
      );
   };

   this.isControlFlowKeyword = function()
   {
      var value = this.currentValue();
      return contains(
         ["if", "for", "while", "else", "function",
          "repeat", "break", "next"],
         value
      );
   };

   this.isAtStartOfNewExpression = function(ifAtStartOfDocument)
   {
      var clone = this.cloneCursor();

      if (!clone.moveToPreviousToken())
         return ifAtStartOfDocument;

      if (this.isValidForStartOfStatement() &&
          clone.isValidForEndOfStatement() &&
          this.$row > clone.$row)
      {
         // If the previous token is a control flow keyword,
         // this is not a new expression (current cursor continues
         // previous expression)
         if (clone.isControlFlowKeyword())
            return false;
         
         // If the previous cursor is on a closing bracket,
         // ensure that it's not associated with control flow
         if (clone.currentValue() === ")" &&
             clone.bwdToMatchingToken() &&
             clone.moveToPreviousToken() &&
             clone.isConditionalControlFlowKeyword())
         {
            return false;
         }

         // Otherwise, these are separate statements.
         return true;
      }

      return false;
      
   };
   
}).call(RTokenCursor.prototype);


exports.TokenCursor = TokenCursor;
exports.CppTokenCursor = CppTokenCursor;
exports.RTokenCursor = RTokenCursor;

});


/*
 * token_utils.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/token_utils", ["require", "exports", "module"], function(require, exports, module) {

var TokenUtils = function(doc, tokenizer, tokens,
                          statePattern, codeBeginPattern, codeEndPattern) {
   this.$doc = doc;
   this.$tokenizer = tokenizer;
   this.$tokens = tokens;
   this.$endStates = new Array(doc.getLength());
   this.$statePattern = statePattern;
   this.$codeBeginPattern = codeBeginPattern;
   this.$codeEndPattern = codeEndPattern;
};

(function() {

   function isWhitespaceOrComment(token)
   {
      // virtual-comment is for roxygen content that needs to be highlighted
      // as TeX, but for the purposes of the code model should be invisible.

      if (/\bcode(?:begin|end)\b/.test(token.type))
         return false;

      if (/\bsectionhead\b/.test(token.type))
         return false;

      return /^\s*$/.test(token.value) ||
             token.type.match(/\b(?:ace_virtual-)?comment\b/);
   }

   /**
    * If headInclusive, then a token will match if it starts at pos.
    * If tailInclusive, then a token will match if it ends at pos (meaning
    *    token.column + token.length == pos.column, and token.row == pos.row
    * In all cases, a token will match if pos is after the head and before the
    *    tail.
    *
    * If no token is found, null is returned.
    *
    * Note that whitespace and comment tokens will never be returned.
    */
   this.getTokenForPos = function(pos, headInclusive, tailInclusive)
   {
      this.$tokenizeUpToRow(pos.row);

      if (this.$tokens.length <= pos.row)
         return null;
      var tokens = this.$tokens[pos.row];
      for (var i = 0; i < tokens.length; i++)
      {
         var token = tokens[i];

         if (headInclusive && pos.column == token.column)
            return token;
         if (pos.column <= token.column)
            return null;

         if (tailInclusive && pos.column == token.column + token.value.length)
            return token;
         if (pos.column < token.column + token.value.length)
            return token;
      }
      return null;
   };

   this.$tokenizeUpToRow = function(lastRow)
   {

      // Don't let lastRow be past the end of the document
      lastRow = Math.min(lastRow, this.$doc.getLength() - 1);
      
      var row = 0;
      var assumeGood = true;
      for ( ; row <= lastRow; row++)
      {

         // No need to tokenize rows until we hit one that has been explicitly
         // invalidated.
         if (assumeGood && this.$endStates[row])
            continue;
         
         assumeGood = false;

         var state = (row === 0) ? 'start' : this.$endStates[row - 1];
         var line = this.$doc.getLine(row);
         var lineTokens = this.$tokenizer.getLineTokens(line, state, row);

         if (!this.$statePattern ||
             this.$statePattern.test(lineTokens.state) ||
             this.$statePattern.test(state))
            this.$tokens[row] = this.$filterWhitespaceAndComments(lineTokens.tokens);
         else
            this.$tokens[row] = [];

         // If we ended in the same state that the cache says, then we know that
         // the cache is up-to-date for the subsequent lines--UNTIL we hit a row
         // that has been explicitly invalidated.
         if (lineTokens.state === this.$endStates[row])
            assumeGood = true;
         else
            this.$endStates[row] = lineTokens.state;
      }
      
      if (!assumeGood)
      {
         // If we get here, it means the last row we saw before we exited
         // was invalidated or impacted by an invalidated row. We need to
         // make sure the NEXT row doesn't get ignored next time the tokenizer
         // makes a pass.
         if (row < this.$tokens.length)
            this.$invalidateRow(row);
      }
      
      return true;
   };

   this.$filterWhitespaceAndComments = function(tokens)
   {
      tokens = tokens.filter(function (t) {
         return !isWhitespaceOrComment(t);
      });

      for (var i = tokens.length - 1; i >= 0; i--)
      {
         if (tokens[i].value.length > 1 && /\bparen\b/.test(tokens[i].type))
         {
            var token = tokens[i];
            tokens.splice(i, 1);
            for (var j = token.value.length - 1; j >= 0; j--)
            {
               var newToken = {
                  type: token.type,
                  value: token.value.charAt(j),
                  column: token.column + j
               };
               tokens.splice(i, 0, newToken);
            }
         }
      }
      return tokens;
   };

   this.$invalidateRow = function(row)
   {
      this.$tokens[row] = null;
      this.$endStates[row] = null;
   };
   
   this.$insertNewRows = function(row, count)
   {
      var args = [row, 0];
      for (var i = 0; i < count; i++)
         args.push(null);
      this.$tokens.splice.apply(this.$tokens, args);
      this.$endStates.splice.apply(this.$endStates, args);
   };
   
   this.$removeRows = function(row, count)
   {
      this.$tokens.splice(row, count);
      this.$endStates.splice(row, count);
   };

   this.$walkParens = function(startRow, endRow, fun)
   {
      var parenRe = /\bparen\b/;

      if (startRow < endRow)  // forward
      {
         return (function() {
            for ( ; startRow <= endRow; startRow++)
            {
               var tokens = this.$tokens[startRow];
               for (var i = 0; i < tokens.length; i++)
               {
                  if (parenRe.test(tokens[i].type))
                  {
                     var value = tokens[i].value;
                     if (!fun(value, {row: startRow, column: tokens[i].column}))
                        return false;
                  }
               }
            }
            return true;
         }).call(this);
      }
      else // backward
      {
         return (function() {
            startRow = Math.max(0, startRow);
            endRow = Math.max(0, endRow);

            for ( ; startRow >= endRow; startRow--)
            {
               var tokens = this.$tokens[startRow];
               for (var i = tokens.length - 1; i >= 0; i--)
               {
                  if (parenRe.test(tokens[i].type))
                  {
                     var value = tokens[i].value;
                     if (!fun(value, {row: startRow, column: tokens[i].column}))
                        return false;
                  }
               }
            }
            return true;
         }).call(this);
      }
   };

   // Walks BACKWARD over matched pairs of parens. Stop and return result
   // when optional function params preMatch or postMatch return true.
   // preMatch is called when a paren is encountered and BEFORE the parens
   // stack is modified. postMatch is called after the parens stack is modified.
   this.$walkParensBalanced = function(startRow, endRow, preMatch, postMatch, complements)
   {
      // The current stack of parens that are in effect.
      var parens = [];
      var result = null;
      this.$walkParens(startRow, endRow, function(paren, pos)
      {
         if (preMatch && preMatch(parens, paren, pos))
         {
            result = pos;
            return false;
         }

         if (/[\[({]/.test(paren))
         {
            if (parens[parens.length - 1] === complements[paren])
               parens.pop();
            else
               return true;
         }
         else
         {
            parens.push(paren);
         }

         if (postMatch && postMatch(parens, paren, pos))
         {
            result = pos;
            return false;
         }

         return true;
      });

      return result;
   };
   
   this.$findNextSignificantToken = function(pos, lastRow)
   {
      if (this.$tokens.length == 0)
         return null;
      lastRow = Math.min(lastRow, this.$tokens.length - 1);
      
      var row = pos.row;
      var col = pos.column;
      for ( ; row <= lastRow; row++)
      {
         var tokens = this.$tokens[row];

         for (var i = 0; i < tokens.length; i++)
         {
            if (tokens[i].column + tokens[i].value.length > col)
            {
               return {
                  token: tokens[i], 
                  row: row, 
                  column: Math.max(tokens[i].column, col),
                  offset: i
               };
            }
         }

         col = 0; // After the first row, we'll settle for a token anywhere
      }
      return null;
   };

   this.findNextSignificantToken = function(pos)
   {
	   return this.$findNextSignificantToken(pos, this.$tokens.length - 1);
   };
   
   this.$findPreviousSignificantToken = function(pos, firstRow)
   {
      if (this.$tokens.length == 0)
         return null;
      firstRow = Math.max(0, firstRow);
      
      var row = Math.min(pos.row, this.$tokens.length - 1);
      for ( ; row >= firstRow; row--)
      {
         var tokens = this.$tokens[row];
         if (tokens.length == 0)
            continue;
         
         if (row != pos.row)
            return {
               row: row,
               column: tokens[tokens.length - 1].column,
               token: tokens[tokens.length - 1],
               offset: tokens.length - 1
            };
         
         for (var i = tokens.length - 1; i >= 0; i--)
         {
            if (tokens[i].column < pos.column)
            {
               return {
                  row: row,
                  column: tokens[i].column,
                  token: tokens[i],
                  offset: i
               };
            }
         }
      }

      return null;
   };
   
   
}).call(TokenUtils.prototype);

exports.TokenUtils = TokenUtils;

});
/*
 * utils.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/utils", ["require", "exports", "module"], function(require, exports, module) {

var Range = require("ace/range").Range;
var TokenIterator = require("ace/token_iterator").TokenIterator;
var unicode = require("ace/unicode");
var YamlHighlightRules = require("mode/yaml_highlight_rules").YamlHighlightRules;

(function() {

   var that = this;
   var reWordCharacter = new RegExp("^[" + unicode.wordChars + "._]+", "");

   // Simulate 'new Foo([args])'; ie, construction of an
   // object from an array of arguments
   this.construct = function(constructor, args)
   {
      function F() {
         return constructor.apply(this, args);
      }

      F.prototype = constructor.prototype;
      return new F();
   };

   this.contains = function(array, object)
   {
      for (var i = 0; i < array.length; i++)
         if (array[i] === object)
            return true;

      return false;
   };

   this.isArray = function(object)
   {
      return Object.prototype.toString.call(object) === '[object Array]';
   };

   this.asArray = function(object)
   {
      return that.isArray(object) ? object : [object];
   };

   this.getPrimaryState = function(session, row)
   {
      return that.primaryState(session.getState(row));
   };

   this.primaryState = function(states)
   {
      if (that.isArray(states))
      {
         for (var i = 0; i < states.length; i++)
         {
            var state = states[i];
            if (state === "#tmp")
               continue;
            return state || "start";
         }
      }

      return states || "start";
   };

   this.activeMode = function(state, major)
   {
      var primary = that.primaryState(state);
      var modeIdx = primary.lastIndexOf("-");
      if (modeIdx === -1)
         return major;
      return primary.substring(0, modeIdx).toLowerCase();
   };

   this.endsWith = function(string, suffix)
   {
      return string.indexOf(suffix, string.length - suffix.length) !== -1;
   };

   this.escapeRegExp = function(string)
   {
      return string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
   };

   this.embedRules = function(HighlightRules, EmbedRules,
                              prefix, reStart, reEnd,
                              startStates, endState)
   {
      if (typeof startStates === "undefined")
         startStates = ["start"];

      if (typeof endState === "undefined")
         endState = "start";

      startStates = that.asArray(startStates);
      var rules = HighlightRules.$rules;

      HighlightRules.embedRules(EmbedRules, prefix + "-", [{
         regex: reEnd,
         onMatch: function(value, state, stack, line, context) {

            // Check whether the width of this chunk tail matches
            // the width of the chunk header that started this chunk.
            var match = /^\s*((?:`|-|\.)+)/.exec(value);
            var width = match[1].length;
            if (context.chunk.width !== width) {
               this.next = state;
               return "text";
            }

            // Update the next state and return the matched token.
            this.next = context.chunk.state || "start";
            delete context.chunk;
            return "support.function.codeend";
         }
      }]);

      for (var i = 0; i < startStates.length; i++) {
         rules[startStates[i]].unshift({
            regex: reStart,
            onMatch: function(value, state, stack, line, context) {

               // Check whether we're already within a chunk. If so,
               // skip this chunk header -- assume that it's embedded
               // within another active chunk.
               context.chunk = context.chunk || {};
               if (context.chunk.state != null) {
                  this.next = state;
                  return "text";
               }

               // A chunk header was found; record the state we entered
               // from, and also the width of the chunk header.
               var match = /^\s*((?:`|-|\.)+)/.exec(value);
               context.chunk.width = match[1].length;
               context.chunk.state = state;

               // Update the next state and return the matched token.
               this.next = prefix + "-start";
               return "support.function.codebegin";
            }
         });
      }
   };

   this.isSingleLineString = function(string)
   {
      if (string.length < 2)
         return false;

      var firstChar = string[0];
      if (firstChar !== "'" && firstChar !== "\"")
         return false;

      var lastChar = string[string.length - 1];
      if (lastChar !== firstChar)
         return false;

      var isEscaped = string[string.length - 2] === "\\" &&
                      string[string.length - 3] !== "\\";

      if (isEscaped)
         return false;

      return true;
   };

   this.createTokenIterator = function(editor)
   {
      var position = editor.getSelectionRange().start;
      var session = editor.getSession();
      return new TokenIterator(session, position.row, position.column);
   };

   this.isWordCharacter = function(string)
   {
      return reWordCharacter.test(string);
   };

   // The default set of complements is R-centric.
   var $complements = {

      "'" : "'",
      '"' : '"',
      "`" : "`",

      "{" : "}",
      "(" : ")",
      "[" : "]",
      "<" : ">",

      "}" : "{",
      ")" : "(",
      "]" : "[",
      ">" : "<"
   };

   this.isBracket = function(string, allowArrow)
   {
      if (!!allowArrow && (string === "<" || string === ">"))
         return true;

      return string === "{" || string === "}" ||
             string === "(" || string === ")" ||
             string === "[" || string === "]";

   };

   this.isOpeningBracket = function(string, allowArrow)
   {
      return string === "{" ||
             string === "(" ||
             string === "[" ||
             (!!allowArrow && string === "<");
   };

   this.isClosingBracket = function(string, allowArrow)
   {
      return string === "}" ||
             string === ")" ||
             string === "]" ||
             (!!allowArrow && string === ">");
   };

   this.getComplement = function(string, complements)
   {
      if (typeof complements === "undefined")
         complements = $complements;

      var complement = complements[string];
      if (typeof complement === "undefined")
         return string;

      return complement;
   };

   this.stripEnclosingQuotes = function(string)
   {
      var n = string.length;
      if (n < 2)
         return string;

      var firstChar = string[0];
      var isQuote =
             firstChar === "'" ||
             firstChar === "\"" ||
             firstChar === "`";

      if (!isQuote)
         return string;

      var lastChar = string[n - 1];
      if (lastChar !== firstChar)
         return string;

      return string.substr(1, n - 2);
   };

   this.startsWith = function(string, prefix)
   {
      if (typeof string !== "string") return false;
      if (typeof prefix !== "string") return false;
      if (string.length < prefix.length) return false;

      for (var i = 0; i < prefix.length; i++)
         if (string[i] !== prefix[i])
            return false;

      return true;
   };

   this.getTokenTypeRegex = function(type)
   {
      return new RegExp("(?:^|[.])" + type + "(?:$|[.])", "");
   }

   this.embedQuartoHighlightRules = function(self)
   {
      // Embed YAML highlighting rules
      var prefix = "quarto-yaml-";
      self.embedRules(YamlHighlightRules, prefix);

      // allow Quarto YAML comments within each kind of chunk
      for (var state in self.$rules) {

         // add rules for highlighting YAML comments
         // TODO: Associate embedded rules with their comment tokens
         if (state === "start" || state.indexOf("-start") !== -1) {
            self.$rules[state].unshift({
               token: "comment.doc.tag",
               regex: "^\\s*#[|]",
               push: prefix + "start"
            });
         }

         // allow Quarto YAML highlight rules to consume leading comments
         if (state.indexOf(prefix) === 0) {

            // make sure YAML rules can consume a leading #|
            self.$rules[state].unshift({
               token: ["whitespace", "comment.doc.tag"],
               regex: "^(\\s*)(#[|])",
               next: state
            });

            // make sure YAML rules exit when there's no leading #|
            self.$rules[state].unshift({
               token: "whitespace",
               regex: "^\\s*(?!#)",
               next: "pop"
            });

         }

         self.$rules[prefix + "start"].unshift({
            token: "text",
            regex: "^\\s*(?!#)",
            next: "pop"
         });

         // allow for multi-line strings in YAML comments
         self.$rules[prefix + "multiline-string"].unshift({
            regex: /^(#[|])(\s*)/,
            onMatch: function(value, state, stack, line, context) {

               // apply token splitter regex
               var tokens = this.splitRegex.exec(value);

               // if we matched the whole line, continue in the multi-string state
               if (line === tokens[1] + tokens[2]) {
                  this.next = state;
               } else {
                  // if the indent has decreased relative to what
                  // was used to start the multiline string, then
                  // exit multiline string state
                  var indent = tokens[2].length;
                  if (context.yaml.indent >= indent) {
                     this.next = context.yaml.state;
                  } else {
                     this.next = state + "-rest";
                  }
               }

               // retrieve tokens for the matched value
               return [
                  { type: "comment.doc.tag", value: tokens[1] },
                  { type: "indent", value: tokens[2] }
               ];
            }
         });

      }
   }


}).call(exports);

});
/*
 * xml.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/xml", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var Tokenizer = require("ace/tokenizer").Tokenizer;
var XmlHighlightRules = require("mode/xml_highlight_rules").XmlHighlightRules;
var XmlBehaviour = require("mode/xml_behavior").XmlBehaviour;
var XmlFoldMode = require("mode/xml_fold_mode").FoldMode;

var Mode = function() {
    this.$tokenizer = new Tokenizer(new XmlHighlightRules().getRules());
    this.$behaviour = new XmlBehaviour();
    this.foldingRules = new XmlFoldMode();
};

oop.inherits(Mode, TextMode);

(function() {
    
    this.getNextLineIndent = function(state, line, tab) {
        return this.$getIndent(line);
    };

}).call(Mode.prototype);

exports.Mode = Mode;
});
/*
 * xml_behavior.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/xml_behavior", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var Behaviour = require("ace/mode/behaviour").Behaviour;
var CstyleBehaviour = require("ace/mode/behaviour/cstyle").CstyleBehaviour;
var TokenIterator = require("ace/token_iterator").TokenIterator;

function hasType(token, type) {
    var hasType = true;
    var typeList = token.type.split('.');
    var needleList = type.split('.');
    needleList.forEach(function(needle){
        if (typeList.indexOf(needle) == -1) {
            hasType = false;
            return false;
        }
    });
    return hasType;
}

var XmlBehaviour = function () {
    
    this.inherit(CstyleBehaviour, ["string_dquotes"]); // Get string behaviour
    
    this.add("autoclosing", "insertion", function (state, action, editor, session, text) {
        if (text == '>') {
            var position = editor.getCursorPosition();
            var iterator = new TokenIterator(session, position.row, position.column);
            var token = iterator.getCurrentToken();
            var atCursor = false;
            if (!token || !hasType(token, 'meta.tag') && !(hasType(token, 'text') && token.value.match('/'))){
                do {
                    token = iterator.stepBackward();
                } while (token && (hasType(token, 'string') || hasType(token, 'keyword.operator') || hasType(token, 'entity.attribute-name') || hasType(token, 'text')));
            } else {
                atCursor = true;
            }
            if (!token || !hasType(token, 'meta.tag-name') || iterator.stepBackward().value.match('/')) {
                return
            }
            var tag = token.value;
            if (atCursor){
                var tag = tag.substring(0, position.column - token.start);
            }

            return {
               text: '>' + '</' + tag + '>',
               selection: [1, 1]
            }
        }
    });

    this.add('autoindent', 'insertion', function (state, action, editor, session, text) {
        if (text == "\n") {
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            var rightChars = line.substring(cursor.column, cursor.column + 2);
            if (rightChars == '</') {
                var indent = this.$getIndent(session.doc.getLine(cursor.row)) + session.getTabString();
                var next_indent = this.$getIndent(session.doc.getLine(cursor.row));

                return {
                    text: '\n' + indent + '\n' + next_indent,
                    selection: [1, indent.length, 1, indent.length]
                }
            }
        }
    });
    
}
oop.inherits(XmlBehaviour, Behaviour);

exports.XmlBehaviour = XmlBehaviour;
});
/*
 * xml_fold_mode.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/xml_fold_mode", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var Range = require("ace/range").Range;
var BaseFoldMode = require("ace/mode/folding/fold_mode").FoldMode;
var TokenIterator = require("ace/token_iterator").TokenIterator;

var FoldMode = exports.FoldMode = function(voidElements) {
    BaseFoldMode.call(this);
    this.voidElements = voidElements || {};
};
oop.inherits(FoldMode, BaseFoldMode);

(function() {

    this.getFoldWidget = function(session, foldStyle, row) {
        var tag = this._getFirstTagInLine(session, row);

        if (tag.closing)
            return foldStyle == "markbeginend" ? "end" : "";

        if (!tag.tagName || this.voidElements[tag.tagName.toLowerCase()])
            return "";

        if (tag.selfClosing)
            return "";

        if (tag.value.indexOf("/" + tag.tagName) !== -1)
            return "";

        return "start";
    };
    
    this._getFirstTagInLine = function(session, row) {
        var tokens = session.getTokens(row);
        var value = "";
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token.type.indexOf("meta.tag") === 0)
                value += token.value;
            else
                value += lang.stringRepeat(" ", token.value.length);
        }
        
        return this._parseTag(value);
    };

    this.tagRe = /^(\s*)(<?(\/?)([-_a-zA-Z0-9:!]*)\s*(\/?)>?)/;
    this._parseTag = function(tag) {
        
        var match = this.tagRe.exec(tag);
        var column = this.tagRe.lastIndex || 0;
        this.tagRe.lastIndex = 0;

        return {
            value: tag,
            match: match ? match[2] : "",
            closing: match ? !!match[3] : false,
            selfClosing: match ? !!match[5] || match[2] == "/>" : false,
            tagName: match ? match[4] : "",
            column: match[1] ? column + match[1].length : column
        };
    };
    
    /*
     * reads a full tag and places the iterator after the tag
     */
    this._readTagForward = function(iterator) {
        var token = iterator.getCurrentToken();
        if (!token)
            return null;
            
        var value = "";
        var start;
        
        do {
            if (token.type.indexOf("meta.tag") === 0) {
                if (!start) {
                    var start = {
                        row: iterator.getCurrentTokenRow(),
                        column: iterator.getCurrentTokenColumn()
                    };
                }
                value += token.value;
                if (value.indexOf(">") !== -1) {
                    var tag = this._parseTag(value);
                    tag.start = start;
                    tag.end = {
                        row: iterator.getCurrentTokenRow(),
                        column: iterator.getCurrentTokenColumn() + token.value.length
                    };
                    iterator.stepForward();
                    return tag;
                }
            }
        } while(token = iterator.stepForward());
        
        return null;
    };
    
    this._readTagBackward = function(iterator) {
        var token = iterator.getCurrentToken();
        if (!token)
            return null;
            
        var value = "";
        var end;

        do {
            if (token.type.indexOf("meta.tag") === 0) {
                if (!end) {
                    end = {
                        row: iterator.getCurrentTokenRow(),
                        column: iterator.getCurrentTokenColumn() + token.value.length
                    };
                }
                value = token.value + value;
                if (value.indexOf("<") !== -1) {
                    var tag = this._parseTag(value);
                    tag.end = end;
                    tag.start = {
                        row: iterator.getCurrentTokenRow(),
                        column: iterator.getCurrentTokenColumn()
                    };
                    iterator.stepBackward();
                    return tag;
                }
            }
        } while(token = iterator.stepBackward());
        
        return null;
    };
    
    this._pop = function(stack, tag) {
        while (stack.length) {
            
            var top = stack[stack.length-1];
            if (!tag || top.tagName == tag.tagName) {
                return stack.pop();
            }
            else if (this.voidElements[tag.tagName]) {
                return;
            }
            else if (this.voidElements[top.tagName]) {
                stack.pop();
                continue;
            } else {
                return null;
            }
        }
    };
    
    this.getFoldWidgetRange = function(session, foldStyle, row) {
        var firstTag = this._getFirstTagInLine(session, row);
        
        if (!firstTag.match)
            return null;
        
        var isBackward = firstTag.closing || firstTag.selfClosing;
        var stack = [];
        var tag;
        
        if (!isBackward) {
            var iterator = new TokenIterator(session, row, firstTag.column);
            var start = {
                row: row,
                column: firstTag.column + firstTag.tagName.length + 2
            };
            while (tag = this._readTagForward(iterator)) {
                if (tag.selfClosing) {
                    if (!stack.length) {
                        tag.start.column += tag.tagName.length + 2;
                        tag.end.column -= 2;
                        return Range.fromPoints(tag.start, tag.end);
                    } else
                        continue;
                }
                
                if (tag.closing) {
                    this._pop(stack, tag);
                    if (stack.length == 0)
                        return Range.fromPoints(start, tag.start);
                }
                else {
                    stack.push(tag)
                }
            }
        }
        else {
            var iterator = new TokenIterator(session, row, firstTag.column + firstTag.match.length);
            var end = {
                row: row,
                column: firstTag.column
            };
            
            while (tag = this._readTagBackward(iterator)) {
                if (tag.selfClosing) {
                    if (!stack.length) {
                        tag.start.column += tag.tagName.length + 2;
                        tag.end.column -= 2;
                        return Range.fromPoints(tag.start, tag.end);
                    } else
                        continue;
                }
                
                if (!tag.closing) {
                    this._pop(stack, tag);
                    if (stack.length == 0) {
                        tag.start.column += tag.tagName.length + 2;
                        return Range.fromPoints(tag.start, end);
                    }
                }
                else {
                    stack.push(tag)
                }
            }
        }
        
    };

}).call(FoldMode.prototype);

});
/*
 * xml_highlight_rules.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/xml_highlight_rules", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var xmlUtil = require("mode/xml_util");
var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

var XmlHighlightRules = function() {

    // regexp must not have capturing parentheses
    // regexps are ordered -> the first match is used
    this.$rules = {
        start : [{
            token : "text",
            regex : "<\\!\\[CDATA\\[",
            next : "cdata"
        }, {
            token : "xml_pe",
            regex : "<\\?.*?\\?>"
        }, {
            token : "comment",
            merge : true,
            regex : "<\\!--",
            next : "comment"
        }, {
            token : "xml_pe",
            regex : "<\\!.*?>"
        }, {
            token : "meta.tag", // opening tag
            regex : "<\\/?",
            next : "tag"
        }, {
            token : "text",
            regex : "\\s+"
        }, {
            token : "constant.character.entity",
            regex : "(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)"
        }, {
            token : "text",
            regex : "[^<]+"
        }],
        
        cdata : [{
            token : "text",
            regex : "\\]\\]>",
            next : "start"
        }, {
            token : "text",
            regex : "\\s+"
        }, {
            token : "text",
            regex : "(?:[^\\]]|\\](?!\\]>))+"
        }],

        comment : [{
            token : "comment",
            regex : ".*?-->",
            next : "start"
        }, {
            token : "comment",
            merge : true,
            regex : ".+"
        }]
    };
    
    xmlUtil.tag(this.$rules, "tag", "start");
};

oop.inherits(XmlHighlightRules, TextHighlightRules);

exports.XmlHighlightRules = XmlHighlightRules;
});
/*
 * xml_util.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("mode/xml_util", ["require", "exports", "module"], function(require, exports, module) {

function string(state) {
    return [{
        token : "string",
        regex : '".*?"'
    }, {
        token : "string", // multi line string start
        merge : true,
        regex : '["].*',
        next : state + "_qqstring"
    }, {
        token : "string",
        regex : "'.*?'"
    }, {
        token : "string", // multi line string start
        merge : true,
        regex : "['].*",
        next : state + "_qstring"
    }];
}

function multiLineString(quote, state) {
    return [{
        token : "string",
        merge : true,
        regex : ".*?" + quote,
        next : state
    }, {
        token : "string",
        merge : true,
        regex : '.+'
    }];
}

exports.tag = function(states, name, nextState, tagMap) {
    states[name] = [{
        token : "text",
        regex : "\\s+"
    }, {
        //token : "meta.tag",
        
    token : function(value) {
            if (tagMap && tagMap[value]) {
                return "meta.tag.tag-name" + '.' + tagMap[value];
            } else {
                return "meta.tag.tag-name";
            }
        },        
        merge : true,
        regex : "[-_a-zA-Z0-9:]+",
        next : name + "_embed_attribute_list" 
    }, {
        token: "empty",
        regex: "",
        next : name + "_embed_attribute_list"
    }];

    states[name + "_qstring"] = multiLineString("'", name + "_embed_attribute_list");
    states[name + "_qqstring"] = multiLineString("\"", name + "_embed_attribute_list");
    
    states[name + "_embed_attribute_list"] = [{
        token : "meta.tag",
        merge : true,
        regex : "\/?>",
        next : nextState
    }, {
        token : "keyword.operator",
        regex : "="
    }, {
        token : "entity.other.attribute-name",
        regex : "[-_a-zA-Z0-9:]+"
    }, {
        token : "constant.numeric", // float
        regex : "[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b"
    }, {
        token : "text",
        regex : "\\s+"
    }].concat(string(name));
};

});
/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/yaml", ["require", "exports", "module"], function(require, exports, module) {

var oop = require("ace/lib/oop");
var TextMode = require("ace/mode/text").Mode;
var YamlHighlightRules = require("mode/yaml_highlight_rules").YamlHighlightRules;
var MatchingBraceOutdent = require("ace/mode/matching_brace_outdent").MatchingBraceOutdent;
var FoldMode = require("ace/mode/folding/coffee").FoldMode;

var Mode = function() {
    this.HighlightRules = YamlHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    this.foldingRules = new FoldMode();
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);

(function() {

    this.lineCommentStart = "#";
    
    this.getNextLineIndent = function(state, line, tab) {
        var indent = this.$getIndent(line);

        if (state == "start") {
            var match = line.match(/^.*[\{\(\[]\s*$/);
            if (match) {
                indent += tab;
            }
        }

        return indent;
    };

    this.checkOutdent = function(state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };

    this.autoOutdent = function(state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };


    this.$id = "mode/yaml";
}).call(Mode.prototype);

exports.Mode = Mode;

});
/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define("mode/yaml_highlight_rules", ["require", "exports", "module"], function (require, exports, module) {

   var oop = require("ace/lib/oop");
   var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

   var makeNumberRule = function(suffix) {
      return {
         token: ["constant.numeric", "text"],
         regex: `([-+]?(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eE][+-]?\\d*)?)(\\s*)${suffix}`
      };
   };

   // NOTE: These highlight rules are embedded in e.g. R, for highlighting of
   // Quarto YAML. Because the "start" of a YAML string might include the '#|'
   // comment prefix, we avoid using the '^' anchor in regular expressions below,
   // and instead just use '\b' to require a word boundary.
   var YamlHighlightRules = function () {

      var rules = {};

      var makeKeywordRule = function(suffix) {
        return {
            token: ["constant.language.boolean", "text"],
            regex: `\\b(true|false|TRUE|FALSE|True|False|yes|no|~)(\\s*)${suffix}`
        }
      }

      rules["#string"] = [
         {
            token: "string",
            regex: "'",
            push: "qstring"
         },
         {
            token: "string",
            regex: "\"",
            push: "qqstring"
         }
      ];

      rules["start"] = [
         {
            token: "comment",
            regex: "#.*"
         },
         {
            token: "whitespace",
            regex: "\\s+"
         },
         {
            token: "list.markup",
            regex: /\b(?:-{3}|\.{3})\s*(?=#|$)/
         },
         {
            token: "list.markup.keyword.operator",
            regex: /[-?](?=$|\s)/
         },
         {
            token: "constant",
            regex: "!![\\w//]+"
         },
         {
            token: "constant.language",
            regex: "[&\\*][a-zA-Z0-9-_]+"
         },
         {
            // (package) (::) (function) (:)
            token: ["meta.tag", "keyword", "meta.tag", "keyword.operator"],
            regex: /\b(\s*[\w\-.]*?)(:{2,3})(\s*[\w\-.]*?)(:(?:\s+|$))/
         },
         {
            // (dictionary-key) (:)
            token: ["meta.tag", "keyword.operator"],
            regex: /\b(\s*[\w\-.]*?)(:(?:\s+|$))/
         },
         {
            token: "keyword.operator",
            regex: "<<\\w*:\\w*"
         },
         {
            token: "keyword.operator",
            regex: "-\\s*(?=[{])"
         },
         {
            include: "#string"
         },
         {
            token: "string", // multi line string start
            regex: /[|>][-+\d\s]*$/,
            onMatch: function (val, state, stack, line, context) {

               // compute indent (allow for comment prefix for comment-embedded YAML)
               var match = /^(?:#[|])?(\s*)/.exec(line);
               var indent = match[1];

               // save prior state + indent length
               context.yaml = context.yaml || {};
               context.yaml.state = state;
               context.yaml.indent = indent.length;

               // return token
               this.next = state.replace(/start$/, "multiline-string");
               return this.token;
            }
         },
         makeNumberRule ("(?=(?:$|#))"),
         makeKeywordRule("(?=(?:$|#))"),
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\[",
            push: "list"
         },
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\{",
            push: "dictionary"
         },
         {
            token: "paren.lparen",
            regex: "[[({]"
         },
         {
            token: "paren.rparen",
            regex: "[\\])}]"
         },
         {
            token: ["text", "whitespace", "comment"],
            regex: "(.+?)(?:$|(\\s+)(#.*))",
         }
      ];

      rules["list"] = [
         {
            token: "paren.rparen.keyword.operator",
            regex: "\\]",
            next: "pop"
         },
         {
            token: "whitespace",
            regex: "\\s+"
         },
         {
            token: "punctuation.keyword.operator",
            regex: ","
         },
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\[",
            push: "list"
         },
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\{",
            push: "dictionary"
         },
         {
            include: "#string"
         },
         makeNumberRule ("(?=(?:$|[,\\]]))"),
         makeKeywordRule("(?=(?:$|[,\\]]))"),
         {
            token: "text",
            regex: "[^,\\]]+",
         }
      ];

      rules["dictionary"] = [
         {
            token: "paren.rparen.keyword.operator",
            regex: "\\}",
            next: "pop"
         },
         {
            token: "whitespace",
            regex: "\\s+"
         },
         {
            token: "punctuation.keyword.operator",
            regex: "[:,]"
         },
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\[",
            push: "list"
         },
         {
            token: "paren.lparen.keyword.operator",
            regex: "\\{",
            push: "dictionary"
         },
         {
            include: "#string"
         },
         makeNumberRule ("(?=(?:$|[:,}]))"),
         makeKeywordRule("(?=(?:$|[:,}]))"),
         {
            token: "text",
            regex: "[^}:,]+",
         }
      ];

      rules["qstring"] = [
         {
            token: "constant.language.escape",
            regex: "''"
         },
         {
            token: "string",
            regex: "'",
            next: "pop"
         },
         {
            token: "string",
            regex: "[^']+"
         }
      ];

      rules["qqstring"] = [
         {
            token: "constant.language.escape",
            regex: "\\\\."
         },
         {
            token: "string",
            regex: "\"",
            next: "pop"
         },
         {
            token: "string",
            regex: "[^\\\\\"]+"
         }
      ];

      rules["multiline-string"] = [
         {
            token: "string",
            regex: /\s*/,
            onMatch: function (value, state, stack, line, context) {

               // skip blank lines (include Quarto comment prefixes)
               if (/^\s*(?:#[|])?\s*$/.test(line)) {
                  this.next = state;
                  return this.token;
               }

               // if the indent has decreased relative to what
               // was used to start the multiline string, then
               // exit multiline string state
               if (context.yaml.indent >= value.length) {
                  this.next = context.yaml.state;
               } else {
                  this.next = state + "-rest";
               }

               return this.token;
            }
         }
      ];

      rules["multiline-string-rest"] = [
         {
            token: "string",
            regex: ".+",
            next: "multiline-string"
         }
      ];

      this.$rules = rules;
      this.normalizeRules();

   };

   oop.inherits(YamlHighlightRules, TextHighlightRules);

   exports.YamlHighlightRules = YamlHighlightRules;
});
/*
 * default.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
define("theme/default", ["require", "exports", "module"], function(require, exports, module) {

    var dom = require("ace/lib/dom");
    exports.cssClass = "ace-rs";
});
/*
 * loader.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

      if (!String.prototype.trimRight) {
         var trimEndRegexp = /\s\s*$/;
         String.prototype.trimRight = function () {
            return String(this).replace(trimEndRegexp, '');
         };
      }

define("rstudio/loader", ["require", "exports", "module"], function(require, exports, module) {

var EditSession = require("ace/edit_session").EditSession;
var Editor = require("ace/editor").Editor;
var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
var ExpandSelection = require("util/expand_selection");
var Range = require("ace/range").Range;
var Renderer = require("ace/virtual_renderer").VirtualRenderer;
var TextMode = require("ace/mode/text").Mode;
var UndoManager = require("ace/undomanager").UndoManager;
var Utils = require("mode/utils");
var event = require("ace/lib/event");
var oop = require("ace/lib/oop");

require("mixins/token_iterator"); // adds mixins to TokenIterator.prototype



// RStudioEditor ----

var RStudioEditor = function(renderer, session) {
   session.renderer = renderer;
   Editor.call(this, renderer, session);
   this.setBehavioursEnabled(true);
};
oop.inherits(RStudioEditor, Editor);

(function() {

   this.$highlightBrackets = function() {

      // don't highlight if we have a selection (avoid a situation
      // where the highlighted bracket could appear to be part of
      // the user's current selection)
      if (!this.session.selection.isEmpty()) {
         var session = this.session;
         if (session.$bracketHighlight) {
            session.$bracketHighlight.markerIds.forEach(function(id) {
               session.removeMarker(id);
            });
            session.$bracketHighlight = null;
         }
         return;
      }

      // delegate to base
      Editor.prototype.$highlightBrackets.call(this);
   };

   // Custom insert to handle enclosing of selection
   this.insert = function(text, pasted)
   {
      if (!this.session.selection.isEmpty())
      {
         // Read UI pref to determine what are eligible for surrounding
         var candidates = [];
         if (this.$surroundSelection === "quotes")
            candidates = ["'", "\"", "`"];
         else if (this.$surroundSelection === "quotes_and_brackets")
            candidates = ["'", "\"", "`", "(", "{", "["];

         // in markdown documents, allow '_', '*' to surround selection
         do
         {
            // assume this preference is only wanted when surrounding
            // other objects in general for now
            if (this.$surroundSelection !== "quotes_and_brackets")
               break;

            var mode = this.session.$mode;
            if (/\/markdown$/.test(mode.$id))
            {
               candidates.push("*", "_");
               break;
            }

            var position = this.getCursorPosition();
            if (mode.getLanguageMode && mode.getLanguageMode(position) === "Markdown")
            {
               candidates.push("*", "_");
               break;
            }
         } while (false);

         if (Utils.contains(candidates, text))
         {
            var lhs = text;
            var rhs = Utils.getComplement(text);
            return this.session.replace(
               this.session.selection.getRange(),
               lhs + this.session.getTextRange() + rhs
            );
         }
      }

      // Delegate to default insert implementation otherwise
      return Editor.prototype.insert.call(this, text, pasted);
   };

   this.remove = function(dir) {
      if (this.session.getMode().wrapRemove) {
         return this.session.getMode().wrapRemove(this, Editor.prototype.remove, dir);
      }
      else {
         return Editor.prototype.remove.call(this, dir);
      }
   };

   this.undo = function() {
      Editor.prototype.undo.call(this);
      this._dispatchEvent("undo");
   };

   this.redo = function() {
      Editor.prototype.redo.call(this);
      this._dispatchEvent("redo");
   };

   this.onPaste = function(text, event) {
      Editor.prototype.onPaste.call(this, text.replace(/\r\n|\n\r|\r/g, "\n"), event);
   };
}).call(RStudioEditor.prototype);



// RStudioEditSession ----

var RStudioEditSession = function(text, mode) {
   EditSession.call(this, text, mode);
};
oop.inherits(RStudioEditSession, EditSession);

(function() {
   this.insert = function(position, text) {
      if (this.getMode().wrapInsert) {
         return this.getMode().wrapInsert(this, EditSession.prototype.insert, position, text);
      }
      else {
         return EditSession.prototype.insert.call(this, position, text);
      }
   };

   this.reindent = function(range) {

      var mode = this.getMode();
      if (!mode.getNextLineIndent)
         return;

      var start = range.start.row;
      var end = range.end.row;

      // First line is always unindented
      if (start === 0) {
         this.applyIndent(0, "");
         start++;
      }

      for (var i = start; i <= end; i++)
      {
         var state = Utils.getPrimaryState(this, i - 1);
         if (Utils.endsWith(state, "qstring") || state === "rawstring")
            continue;

         var newIndent = mode.getNextLineIndent(state,
                                                this.getLine(i - 1),
                                                this.getTabString(),
                                                i - 1,
                                                true);

         this.applyIndent(i, newIndent);
         mode.autoOutdent(state, this, i);
      }

      // optional outdenting (currently hard-wired for C++ modes)
      var codeModel = mode.codeModel;
      if (typeof codeModel !== "undefined") {
         var align = codeModel.alignContinuationSlashes;
         if (typeof align !== "undefined") {
            align(this.getDocument(), {
               start: start,
               end: end
            });
         }
      }


   };
   this.applyIndent = function(lineNum, indent) {
      var line = this.getLine(lineNum);
      var matchLen = line.match(/^\s*/g)[0].length;
      this.replace(new Range(lineNum, 0, lineNum, matchLen), indent);
   };

   this.setDisableOverwrite = function(disableOverwrite) {

      // Note that 'this' refers to the instance, not the prototype. It's
      // important that we override set/getOverwrite on a per-instance basis
      // only.

      if (disableOverwrite) {
         // jcheng 08/21/2012: The old way we did this (see git history) caused
         // a weird bug: the console would pick up the overwrite/insert mode of
         // the active source document iff vim mode was enabled. I could not
         // figure out why.

         // In case we are already in overwrite mode; set it to false so events
         // will be fired.
         this.setOverwrite(false);

         this.setOverwrite = function() { /* no-op */ };
         this.getOverwrite = function() { return false; };
      }
      else {
         // Restore the standard methods
         this.setOverwrite = EditSession.prototype.setOverwrite;
         this.getOverwrite = EditSession.prototype.getOverwrite;
      }
   };
}).call(RStudioEditSession.prototype);



// RStudioUndoManager ----

var RStudioUndoManager = function() {
   UndoManager.call(this);
};
oop.inherits(RStudioUndoManager, UndoManager);

(function() {
   this.peek = function() {
      return this.$undoStack.length ? this.$undoStack[this.$undoStack.length-1]
                                    : null;
   };
}).call(RStudioUndoManager.prototype);



// RStudioRenderer ----

var RStudioRenderer = function(container, theme) {
   Renderer.call(this, container, theme);
};
oop.inherits(RStudioRenderer, Renderer);

(function() {

   this.setTheme = function(theme) {

      if (theme)
         Renderer.prototype.setTheme.call(this, theme);

   }

}).call(RStudioRenderer.prototype);



function loadEditor(container) {
   var env = {};
   container.env = env;

   // Load the editor
   var renderer = new RStudioRenderer(container, "");
   var session = new RStudioEditSession("");
   var editor = new RStudioEditor(renderer, session);
   env.editor = editor;

   var session = editor.getSession();
   session.setMode(new TextMode());
   session.setUndoManager(new RStudioUndoManager());

   // Setup syntax checking
   var config = require("ace/config");
   config.set("basePath", "ace");
   config.set("workerPath", "js/workers");
   config.setDefaultValue("session", "useWorker", false);

   // We handle these commands ourselves.
   function squelch(cmd) {
      env.editor.commands.removeCommand(cmd);
   }
   squelch("findnext");
   squelch("findprevious");
   squelch("find");
   squelch("replace");
   squelch("togglecomment");
   squelch("gotoline");
   squelch("foldall");
   squelch("unfoldall");
   return env.editor;
}

exports.RStudioEditor = RStudioEditor;
exports.loadEditor = loadEditor;
});
/*
 * snippets.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets", ["require", "exports", "module"], function(require, exports, module) {

exports.toSnippetText = function(snippets)
{
   var n = snippets.length;
   var snippetText = "";
   for (var i = 0; i < n; i++)
   {
      var snippet = snippets[i];
      snippetText +=
         "snippet " + snippet.name + "\n" +
         "\t" + snippet.content.replace(/\n/g, "\n\t") + "\n\n";
   }

   return snippetText;
};

exports.normalizeSnippets = function(snippets)
{
   var n = snippets.length;
   for (var i = 0; i < n; i++)
   {
      var snippet = snippets[i];
      if (snippet.tabTrigger == null)
         snippet.tabTrigger = snippet.name;
      snippet.content = snippet.content.replace("\n    ", "\n\t");
   }
};

});
/*
 * c_cpp.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets/c_cpp", ["require", "exports", "module"], function(require, exports, module) {

var utils = require("rstudio/snippets");
var SnippetManager = require("ace/snippets").snippetManager;

var snippets = [
   {
      name: "once",
      content: [
         "#ifndef ${1:`HeaderGuardFileName`}",
         "#define ${1:`HeaderGuardFileName`}",
         "",
         "${0}",
         "",
         "#endif /* ${1:`HeaderGuardFileName`} */"
      ].join("\n")
   },
   {
      name: "ans",
      content: [
         "namespace {",
         "${0}",
         "} // anonymous namespace"
      ].join("\n")
   },
   {
      name: "ns",
      content: [
         "namespace ${1:ns} {",
         "${0}",
         "} // namespace ${1:ns}"
      ].join("\n")
   },
   {
      name: "cls",
      content: [
         "class ${1:ClassName} {",
         "public:",
         "    ${2}",
         "private:",
         "    ${3}",
         "};"
      ].join("\n")
   },
   {
      name: "str",
      content: [
         "struct ${1} {",
         "    ${0}",
         "};"
      ].join("\n")
   },
   {
      name: "ept",
      content: "// [[Rcpp::export]]\n"
   }
];

utils.normalizeSnippets(snippets);
exports.snippetText = utils.toSnippetText(snippets);

SnippetManager.register(snippets, "c_cpp");

});
/*
 * markdown.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets/markdown", ["require", "exports", "module"], function(require, exports, module) {

var utils = require("rstudio/snippets");
var SnippetManager = require("ace/snippets").snippetManager;

var snippets = [
   {
      name: "[",
      content: '[${1:label}](${2:location})'
   },
   {
      name: "![",
      content: '![${1:label}](${2:location})'
   },
   {
      name: "r",
      content: "```{r ${1:label}, ${2:options}}\n${0}\n```"
   },
   {
      name: "rcpp",
      content: "```{r, engine='Rcpp'}\n#include <Rcpp.h>\nusing namespace Rcpp;\n\n${0}\n\n```"
   }
];

utils.normalizeSnippets(snippets);
exports.snippetText = utils.toSnippetText(snippets);

SnippetManager.register(snippets, "markdown");

});
/*
 * r.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets/r", ["require", "exports", "module"], function(require, exports, module) {

var utils = require("rstudio/snippets");
var SnippetManager = require("ace/snippets").snippetManager;

var snippets = [

   /* Import */
   {
      name: "lib",
      content: "library(${1:package})"
   },
   {
      name: "req",
      content: 'require(${1:package})'
   },
   {
      name: "src",
      content: 'source("${1:file.R}")'
   },
   {
      name: "ret",
      content: 'return(${1:code})'
   },
   {
      name: "mat",
      content: 'matrix(${1:data}, nrow = ${2:rows}, ncol = ${3:cols})'
   },

   /* S4 snippets */
   {
      name: "sg",
      content: [
         'setGeneric("${1:generic}", function(${2:x, ...}) {',
         '    standardGeneric("${1:generic}")',
         '})'
      ].join("\n")
   },
   {
      name: "sm",
      content: [
         'setMethod("${1:generic}", ${2:class}, function(${2:x, ...}) {',
         '    ${0}',
         '})'
      ].join("\n")
   },
   {
      name: "sc",
      content: [
         'setClass("${1:Class}", slots = c(${2:name = "type"}))'
      ].join("\n")
   },

   /* Control Flow and Keywords */
   {
      name: "if",
      content: [
         'if (${1:condition}) {',
         '    ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "el",
      content: [
         'else {',
         '    ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "ei",
      content: [
         'else if (${1:condition}) {',
         '    ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "fun",
      content: [
         "${1:name} <- function(${2:variables}) {",
         "    ${0}",
         "}"
      ].join("\n")
   },
   {
      name: "for",
      content: [
         'for (${1:variable} in ${2:vector}) {',
         '    ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "while",
      content: [
         'while (${1:condition}) {',
         '    ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "switch",
      content: [
         'switch (${1:object},',
         '    ${2:case} = ${3:action}',
         ')'
      ].join("\n")
   },

   /* Apply */
   {
      name: "apply",
      content: 'apply(${1:array}, ${2:margin}, ${3:...})'
   },
   {
      name: "lapply",
      content: "lapply(${1:list}, ${2:function})"
   },
   {
      name: "sapply",
      content: "sapply(${1:list}, ${2:function})"
   },
   {
      name: "mapply",
      content: "mapply(${1:function}, ${2:...})"
   },
   {
      name: "tapply",
      content: "tapply(${1:vector}, ${2:index}, ${3:function})"
   },
   {
      name: "vapply",
      content: 'vapply(${1:list}, ${2:function}, FUN.VALUE = ${3:type}, ${4:...})'
   },
   {
      name: "rapply",
      content: "rapply(${1:list}, ${2:function})"
   },

   /* Utilities */
   {
      name: "ts",
      content: '`r paste("#", date(), "------------------------------\\n")`'
   },

   /* Shiny */
   {
      name: "shinyapp",
      content: [
         'library(shiny)',
         '',
         'ui <- fluidPage(',
         '  ${0}',
         ')',
         '',
         'server <- function(input, output, session) {',
         '  ',
         '}',
         '',
         'shinyApp(ui, server)'
      ].join("\n")
   },
   {
      name: "shinymod",
      content: [
         '${1:name}UI <- function(id) {',
         '  ns <- NS(id)',
         '  tagList(',
         '    ${0}',
         '  )',
         '}',
         '',
         '${1:name}Server <- function(id) {',
         '  moduleServer(',
         '    id,',
         '    function(input, output, session) {',
         '      ',
         '    }',
         '  )',
         '}'
      ].join("\n")
   }
];

utils.normalizeSnippets(snippets);
exports.snippetText = utils.toSnippetText(snippets);

SnippetManager.register(snippets, "r");

});
/*
 * stan.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * The Initial Developer of the Original Code is Jeffrey Arnold
 * Portions created by the Initial Developer are Copyright (C) 2015
 * the Initial Developer. All Rights Reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets/stan", ["require", "exports", "module"], function(require, exports, module) {

var utils = require("rstudio/snippets");
var SnippetManager = require("ace/snippets").snippetManager;

var snippets = [
  {
      name: "for",
      content: [
         'for (${1:var} in ${2:start}:${3:end}) {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "if",
      content: [
         'if (${1:condition}) {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "el",
      content: [
         'else (${1:condition}) {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "ei",
      content: [
         'else if (${1:condition}) {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "<l",
      content: "<lower = ${1:expression}>${0}"
   },
   {
      name: "<u",
      content: "<upper = ${1:expression}>${0}"
   },
   {
      name: "<lu",
      content: "<lower = ${1:expression}, upper = ${2:expression}>${0}"
   },
   {
      name: "while",
      content: [
         'while (${1:condition}) {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "gen",
      content: [
         'generated quantities {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "mdl",
      content: [
         'model {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "par",
      content: [
         'parameters {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "tpar",
      content: [
         'transformed parameters {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "data",
      content: [
         'data {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "tdata",
      content: [
         'transformed data {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "ode",
      content: "integrate_ode(${1:function}, ${2:y0}, ${3:t0}, ${4:t}, ${5:theta}, ${6:x_r}, ${7:x_i});"
   },
   {
      name: "funs",
      content: [
         'functions {',
         '  ${0}',
         '}'
      ].join("\n")
   },
   {
      name: "fun",
      content: [
         '${1:return} ${2:name} (${3:args}) {',
         '  ${0}',
         '}'
      ].join("\n")
   }
];

utils.normalizeSnippets(snippets);
exports.snippetText = utils.toSnippetText(snippets);

SnippetManager.register(snippets, "stan");

});
/*
 * yaml.js
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

define("rstudio/snippets/yaml", ["require", "exports", "module"], function(require, exports, module) {

var utils = require("rstudio/snippets");
var SnippetManager = require("ace/snippets").snippetManager;

var snippets = [
   {
      name: "key",
      content: '${1:key}: ${2:value}'
   },
   {
      name: "list",
      content: '${1:key}:\n  - ${2:value1}\n  - ${3:value2}'
   }
];

utils.normalizeSnippets(snippets);
exports.snippetText = utils.toSnippetText(snippets);

SnippetManager.register(snippets, "yaml");

});
