/*
 * Link.java
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

import com.google.gwt.dom.client.Document;

import org.rstudio.core.client.StringUtil;
import org.rstudio.core.client.regex.Match;
import org.rstudio.core.client.regex.Pattern;

public class Link
{
   public Link(String url, String title)
   {
      this(url, title, false);
   }
   
   public Link(String url, String title, boolean preserveHost)
   {
      if (!preserveHost)
         url = removeHost(url);
      url_ = url;
      title_ = title;
      id_ = normalizeUrl(url_);
   }

   /**
    * If the URL has the same scheme, hostname, and port as the current page,
    * then drop them from the URL.
    */
   private String removeHost(String url)
   {
      String pageUrl = Document.get().getURL();
      Pattern p = Pattern.create("^http(s?)://[^/]+");
      Match m = p.match(pageUrl, 0);
      if (m == null)
      {
         assert false : "Couldn't parse page URL: " + url;
         return url;
      }
      String prefix = m.getValue();
      if (!url.startsWith(prefix))
         return url;
      else
         return StringUtil.substring(url, prefix.length());
   }

   public String getUrl()
   {
      return url_;
   }
   
   public String getTitle()
   {
      return title_;
   }
   
   public void setTitle(String title)
   {
      title_ = title;
   }
   
   private static String normalizeUrl(String url)
   {
      return url.indexOf('#') >= 0 ? StringUtil.substring(url, 0, url.indexOf('#')) : url;
   }
   
   @Override
   public int hashCode()
   {
      return (id_ == null) ? 0 : id_.hashCode();
   }
   
   @Override
   public boolean equals(Object obj)
   {
      if (this == obj)
         return true;
      if (obj == null)
         return false;
      if (getClass() != obj.getClass())
         return false;
      Link other = (Link) obj;
      if (id_ == null)
      {
         if (other.id_ != null)
            return false;
      } else if (!id_.equals(other.id_))
         return false;
      return true;
   }

   private final String url_;
   private String title_;
   private final String id_;
}
