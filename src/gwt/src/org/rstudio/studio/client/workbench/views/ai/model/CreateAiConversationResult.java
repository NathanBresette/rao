/*
 * CreateAiConversationResult.java
 *
 * Copyright (C) 2025 by William Nickols
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
package org.rstudio.studio.client.workbench.views.ai.model;

import jsinterop.annotations.JsType;
import jsinterop.annotations.JsPackage;

@JsType(isNative = true, namespace = JsPackage.GLOBAL, name = "Object")
public class CreateAiConversationResult
{
   public boolean success;
   public int index;
   public String path;
   public String message;
} 