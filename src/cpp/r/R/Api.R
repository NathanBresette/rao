#
# Api.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
# Unless you have received this program directly from Posit Software pursuant
# to the terms of a commercial license agreement with Posit Software, then
# this program is licensed to you under the terms of version 3 of the
# GNU Affero General Public License. This program is distributed WITHOUT
# ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
# MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
# AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
#
#

# Create environment to store data for registerChunkCallback and unregisterChunkCallback
.rs.setVar("notebookChunkCallbacks", new.env(parent = emptyenv()))

# Create environment to store data for command callbacks
.rs.setVar("commandCallbacks", new.env(parent = emptyenv()))

# list of API events (keep in sync with RStudioApiRequestEvent.java)
.rs.setVar("api.eventTypes", list(
   TYPE_UNKNOWN              = 0L,
   TYPE_GET_EDITOR_SELECTION = 1L,
   TYPE_SET_EDITOR_SELECTION = 2L,
   TYPE_DOCUMENT_ID          = 3L,
   TYPE_DOCUMENT_OPEN        = 4L,
   TYPE_DOCUMENT_NEW         = 5L,
   TYPE_FILES_PANE_NAVIGATE  = 6L,
   TYPE_SET_GHOST_TEXT       = 7L
   
))

# list of potential event targets
.rs.setVar("api.eventTargets", list(
   TYPE_UNKNOWN       = 0L,
   TYPE_ACTIVE_WINDOW = 1L,
   TYPE_ALL_WINDOWS   = 2L
))

.rs.addApiFunction("isDesktop", function()
{
   .rs.isDesktop()
})

.rs.addApiFunction("restartSession", function(command = NULL,
                                              clean = FALSE,
                                              eager = FALSE)
{
   command <- paste(as.character(command), collapse = "\n")
   if (eager && !grepl("^@", command))
      command <- paste0("@", command)
   
   .rs.restartR(
      afterRestartCommand = as.character(command),
      clean = as.logical(clean)
   )
})

.rs.addApiFunction("initializeProject", function(path = getwd())
{
   path <- .rs.ensureScalarCharacter(path)
   
   # if this is an existing file ...
   if (file.exists(path))
   {
      # ... and it's an .Rproj file, then just return that (don't 
      # re-initialize the project)
      if (grepl("[.]Rproj$", path))
         return(.rs.normalizePath(path, winslash = "/"))
      
      # ... and it's not a directory, bail
      if (!utils::file_test("-d", path))
      {
         fmt <- "file '%s' exists and is not a directory"
         stop(sprintf(fmt, .rs.createAliasedPath(path)))
      }
   }
   
   # otherwise, assume we've received the path to a directory, and
   # attempt to initialize a project within that directory
   .rs.ensureDirectory(path)
   
   # NOTE: list.files() will fail on Windows for paths containing
   # characters not representable in the current locale, so we instead
   # change to the requested directory, list files, and then build the
   # full paths
   rProjFiles <- (function() {
      
      # move to project path
      owd <- setwd(path)
      on.exit(setwd(owd), add = TRUE)
      
      # list files in path
      file.path(path, list.files(pattern = "[.]Rproj$"))

   })()
   
   # if we already have a .Rproj file, just return that
   if (length(rProjFiles))
      return(.rs.normalizePath(rProjFiles[[1]], winslash = "/"))
   
   # otherwise, attempt to create a new .Rproj file, and return
   # the path to the generated file
   rProjFile <- file.path(
      normalizePath(path, mustWork = TRUE, winslash = "/"),
      paste(basename(path), "Rproj", sep = ".")
   )
   
   success <- .Call(
      "rs_writeProjectFile",
      rProjFile,
      PACKAGE = "(embedding)"
   )
   
   if (!success)
   {
      fmt <- "failed to initialize RStudio project in directory '%s'"
      stop(sprintf(fmt, .rs.createAliasedPath(path)))
   }
   
   return(rProjFile)
   
})

.rs.addApiFunction("openProject", function(path = NULL,
                                           newSession = FALSE)
{
   # default to current project directory (note that this can be
   # NULL if the user is not within an RStudio project)
   if (is.null(path))
     path <- .rs.getProjectDirectory()
   
   path <- .rs.ensureScalarCharacter(path)
   
   # attempt to initialize project if necessary
   rProjFile <- .rs.api.initializeProject(path)
   
   # request that we open this project
   invisible(
      .Call("rs_requestOpenProject",
            rProjFile,
            newSession,
            PACKAGE = "(embedding)")
   )
})

.rs.addApiFunction("getVersion", function()
{
   version <- .Call("rs_rstudioVersion", PACKAGE = "(embedding)")
   package_version(version)
})

.rs.addApiFunction("getMode", function()
{
   .Call("rs_rstudioProgramMode", PACKAGE = "(embedding)")
})

.rs.addApiFunction("versionInfo", function()
{
  info <- list()
  info$citation <- .Call("rs_rstudioCitation", PACKAGE = "(embedding)")
  info$mode <- .Call("rs_rstudioProgramMode", PACKAGE = "(embedding)")
  info$edition <- .Call("rs_rstudioEdition", PACKAGE = "(embedding)")
  info$version <- .Call("rs_rstudioVersion", PACKAGE = "(embedding)")
  info$version <- package_version(info$version)
  info$long_version <- .Call("rs_rstudioLongVersion", PACKAGE = "(embedding)")
  info$release_name <- .Call("rs_rstudioReleaseName", PACKAGE = "(embedding)")
  info
})

.rs.addApiFunction("diagnosticsReport", function() {
   invisible(.Call("rs_sourceDiagnostics", PACKAGE = "(embedding)"))
})


.rs.addApiFunction("previewRd", function(rdFile) {
   
   if (!is.character(rdFile) || (length(rdFile) != 1))
      stop("rdFile must be a single element character vector.")
   if (!file.exists(rdFile))
      stop("The specified rdFile ' ", rdFile, "' does not exist.")
   
   invisible(.Call("rs_previewRd", rdFile, PACKAGE = "(embedding)"))
   
})

.rs.addApiFunction("viewer", function(url, height = NULL) {

  if (!is.character(url) || (length(url) != 1))
    stop("url must be a single element character vector.")

  if (identical(height, "maximize"))
     height <- -1

  if (!is.null(height) && (!is.numeric(height) || (length(height) != 1)))
     stop("height must be a single element numeric vector or 'maximize'.")

  invisible(.Call("rs_viewer", url, height, PACKAGE = "(embedding)"))
})


.rs.addApiFunction("savePlotAsImage", function(
                   file,
                   format = c("png", "jpeg", "bmp", "tiff", "emf", "svg", "eps"),
                   width,
                   height) {

   file <- path.expand(file)
   format <- match.arg(format)
   if (!is.numeric(width))
      stop("width argument mut be numeric", call. = FALSE)
   if (!is.numeric(height))
      stop("height argument mut be numeric", call. = FALSE)
   
   invisible(.Call("rs_savePlotAsImage", file, format, width, height, PACKAGE = "(embedding)"))
})

.rs.addApiFunction("sourceMarkers", function(name,
                                             markers,
                                             basePath = NULL,
                                             autoSelect = c("none", "first", "error")) {

   # validate name
   if (!is.character(name))
      stop("name parameter is specified or invalid: ", name, call. = FALSE)

   # validate autoSelect
   autoSelect = match.arg(autoSelect)

   # normalize basePath
   if (!is.null(basePath))
      basePath <- .rs.normalizePath(basePath,  mustWork = TRUE)

   if (is.data.frame(markers)) {

      cols <- colnames(markers)

      if (!"type" %in% cols || !is.character(markers$type))
         stop("markers type field is unspecified or invalid", call. = FALSE)
      if (!"file" %in% cols || !is.character(markers$file))
         stop("markers file field is unspecified or invalid", call. = FALSE)
      if (!"line" %in% cols || !is.numeric(markers$line))
         stop("markers line field is unspecified or invalid", call. = FALSE)
      if (!"column" %in% cols || !is.numeric(markers$column))
         stop("markers column field is unspecified or invalid", call. = FALSE)
      if (!"message" %in% cols || !is.character(markers$message))
         stop("markers message field is unspecified or invalid", call. = FALSE)

      # normalize paths
      markers$file <- .rs.normalizePath(markers$file, mustWork = TRUE)
   } else if (is.list(markers)) {
      markers <- lapply(markers, function(marker) {
         markerTypes <- c("error", "warning", "box", "info", "style", "usage")
         if (is.null(marker$type) || (!marker$type %in% markerTypes))
            stop("Invalid marker type (", marker$type, ")", call. = FALSE)
         if (!is.character(marker$file))
            stop("Marker file is unspecified or invalid: ", marker$file, call. = FALSE)
         if (!is.numeric(marker$line))
            stop("Marker line is unspecified or invalid", marker$line, call. = FALSE)
         if (!is.numeric(marker$column))
            stop("Marker column is unspecified or invalid", marker$line, call. = FALSE)
         if (!is.character(marker$message))
            stop("Marker message is unspecified or invalid: ", marker$message, call. = FALSE)

         marker$type <- .rs.scalar(marker$type)
         marker$file <- .rs.scalar(.rs.normalizePath(marker$file, mustWork = TRUE))
         marker$line <- .rs.scalar(as.numeric(marker$line))
         marker$column <- .rs.scalar(as.numeric(marker$column))
         marker$message <- .rs.scalar(marker$message)
         
         marker
      })
   } else {
      stop("markers was not a data.frame or a list", call. = FALSE)
   }

   # validate basePath
   if (is.null(basePath))
      basePath <- ""
   else if (!is.character(basePath))
      stop("basePath parameter is not of type character", call. = FALSE)

   invisible(.Call("rs_sourceMarkers", name, markers, basePath, autoSelect, PACKAGE = "(embedding)"))
})

.rs.addApiFunction("navigateToFile", function(filePath = character(0),
                                              line = -1L,
                                              col = -1L,
                                              moveCursor = TRUE)
{
   .rs.api.documentOpen(filePath, line = line, col = col, moveCursor = moveCursor)
})

.rs.addFunction("validateAndTransformLocation", function(location)
{
   invalidRangeMsg <- "'ranges' should be a list of 4-element integer vectors"

   # allow a single range (then validate that it's a true range after)
   if (!is.list(location) || inherits(location, "document_range"))
      location <- list(location)

   ranges <- lapply(location, function(el) {

      # detect proxy Inf object
      if (identical(el, Inf))
         el <- c(Inf, 0, Inf, 0)

      # detect positions (2-element vectors) and transform them to ranges
      n <- length(el)
      if (n == 2 && is.numeric(el))
         el <- c(el, el)

      # detect document_ranges and transform
      if (is.list(el) && all(c("start", "end") %in% names(el)))
         el <- c(el$start, el$end)

      # validate we have a range-like object
      if (length(el) != 4 || !is.numeric(el) || any(is.na(el)))
         stop(invalidRangeMsg, call. = FALSE)

      # transform out-of-bounds values appropriately
      el[el < 1] <- 1
      el[is.infinite(el)] <- NA

      # transform from 1-based to 0-based indexing for server
      result <- as.integer(el) - 1L

      # treat NAs as end of row / column
      result[is.na(result)] <- as.integer(2 ^ 31 - 1)

      result
   })

   ranges
})

.rs.addFunction("enqueEditorClientEvent", function(type, data)
{
   eventData <- list(type = .rs.scalar(type), data = data)
   .rs.enqueClientEvent("editor_command", eventData)
})

.rs.addApiFunction("insertText", function(location, text, id = "")
{
   invalidTextMsg <- "'text' should be a character vector"
   invalidLengthMsg <- "'text' should either be length 1, or same length as 'ranges'"

   if (is.null(id))
      id <- ""

   if (!is.character(id))
      stop("'id' must be NULL or a character vector of length one")

   # allow calls of the form:
   #
   #    insertText("foo")
   #    insertText(text = "foo")
   #
   # in such cases, we replace the current selection. we pass an empty range
   # and let upstream interpret this as a request to replace the current
   # selection.
   if (missing(location))
      location <- NULL
   
   if (missing(text))
      text <- NULL
   
   if (is.null(text) && is.character(location))
   {
      return(.rs.api.selectionSet(value = location, id = id))
   }
   else if (is.null(location) && is.character(text))
   {
      return(.rs.api.selectionSet(value = text, id = id))
   }
   else if (length(location) == 0)
   {
      return()
   }

   ranges <- .rs.validateAndTransformLocation(location)
   if (!is.character(text))
      stop(invalidTextMsg, call. = FALSE)

   if (length(text) != 1 && length(ranges) != length(text))
      stop(invalidLengthMsg, call. = FALSE)

   # sort the ranges in decreasing order -- this way, we can
   # ensure the replacements occur correctly (except in the
   # case of overlaps)
   if (length(ranges)) {
      idx <- order(unlist(lapply(ranges, `[[`, 1)))

      ranges <- ranges[idx]
      if (length(text) != 1)
         text <- text[idx]
   }

   data <- list(ranges = ranges, text = text, id = .rs.scalar(id))
   .rs.enqueEditorClientEvent("replace_ranges", data)
   invisible(data)
})

.rs.addApiFunction("modifyRange", function(location, text, id = "")
{
   .rs.api.insertText(location, text, id)
})

.rs.addApiFunction("setSelectionRanges", function(ranges, id = "")
{
   ranges <- .rs.validateAndTransformLocation(ranges)
   data <- list(ranges = ranges, id = .rs.scalar(id))
   .rs.enqueEditorClientEvent("set_selection_ranges", data)
   invisible(data)
})

# NOTE: Kept for backwards compatibility with older versions
# of the 'rstudioapi' package -- it is superceded by
# '.rs.getLastActiveEditorContext()'.
.rs.addApiFunction("getActiveDocumentContext", function() {
   .Call("rs_getEditorContext", 0L, NULL, PACKAGE = "(embedding)")
})

.rs.addApiFunction("getLastActiveEditorContext", function() {
   .Call("rs_getEditorContext", 0L, NULL, PACKAGE = "(embedding)")
})

.rs.addApiFunction("getConsoleEditorContext", function() {
   .Call("rs_getEditorContext", 1L, NULL, PACKAGE = "(embedding)")
})

.rs.addApiFunction("getSourceEditorContext", function(id = NULL) {
   .Call("rs_getEditorContext", 2L, id, PACKAGE = "(embedding)")
})

.rs.addApiFunction("getActiveProject", function() {
   .rs.getProjectDirectory()
})

.rs.addApiFunction("sendToConsole", function(code,
                                             echo = TRUE,
                                             execute = TRUE,
                                             focus = TRUE, 
                                             animate = FALSE)
{
   if (!is.character(code))
      stop("'code' should be a character vector", call. = FALSE)

   code <- paste(code, collapse = "\n")
   data <- list(
      code = .rs.scalar(code),
      echo = .rs.scalar(as.logical(echo)),
      execute = .rs.scalar(as.logical(execute)),
      focus = .rs.scalar(as.logical(focus)),
      animate = .rs.scalar(as.logical(animate)),
      language = "R"
   )

   .rs.enqueClientEvent("send_to_console", data)
   invisible(data)
})

.rs.addApiFunction("askForPassword", function(prompt) {
   .rs.askForPassword(prompt)
})

.rs.addFunction("dialogIcon", function(name = NULL) {
  
   icons <- list(
      info = 1,
      warning = 2,
      error = 3,
      question = 4
   )
   
   if (is.null(name))
      icons
   else
      icons[[name]]
   
})

.rs.addApiFunction("showDialog", function(title, message, url = "") {
   
   # ensure URL is a string
   if (is.null(url) || is.na(url))
      url <- ""
   
   .Call("rs_showDialog",
      title = title,
      message = message,
      dialogIcon = .rs.dialogIcon("info"),
      prompt = FALSE,
      promptDefault = "",
      ok = "OK",
      cancel = "Cancel",
      url = url,
      PACKAGE = "(embedding)")
})

.rs.addApiFunction("updateDialog", function(...)
{
   scalarValues <- lapply(list(...), .rs.scalar)
   .rs.enqueClientEvent("update_new_connection_dialog", scalarValues)

   invisible(NULL)
})

.rs.addApiFunction("showPrompt", function(title, message, default = "") {
   
   # ensure default is a string
   if (is.null(default) || is.na(default))
      default <- ""
   
   .Call("rs_showDialog",
      title = title,
      message = message,
      dialogIcon = .rs.dialogIcon("info"),
      prompt = TRUE,
      promptDefault = default,
      ok = "OK",
      cancel = "Cancel",
      url = "",
      PACKAGE = "(embedding)")
})

.rs.addApiFunction("showQuestion", function(title, message, ok = "OK", cancel = "Cancel") {
   
   # fix up ok, cancel
   if (is.null(ok) || is.na(ok))
      ok <- "OK"
   
   if (is.null(cancel) || is.na(cancel))
      cancel <- "Cancel"
   
   .Call("rs_showDialog",
      title = title,
      message = message,
      dialogIcon = .rs.dialogIcon("question"),
      prompt = FALSE,
      promptDefault = NULL,
      ok = ok,
      cancel = cancel,
      url = NULL,
      PACKAGE = "(embedding)")
})

.rs.addApiFunction("writePreference", function(name, value) {
  .rs.writeApiPref(name, value)
})

.rs.addApiFunction("readPreference", function(name, default = NULL) {
  value <- .rs.readApiPref(name)
  if (is.null(value)) default else value
})

.rs.addApiFunction("writeRStudioPreference", function(name, value) {
  .rs.writeUiPref(name, value)
})

.rs.addApiFunction("readRStudioPreference", function(name, default = NULL) {
  value <- .rs.readUiPref(name)
  if (is.null(value)) default else value
})

.rs.addApiFunction("setPersistentValue", function(name, value) {
   invisible(.Call("rs_setPersistentValue", name, value))
})

.rs.addApiFunction("getPersistentValue", function(name) {
   .Call("rs_getPersistentValue", name)
})

.rs.addApiFunction("documentId", function(allowConsole = TRUE) {
   
   payload <- list(
      allow_console = .rs.scalar(allowConsole)
   )
   
   request <- .rs.api.createRequest(
      type    = .rs.api.eventTypes$TYPE_DOCUMENT_ID,
      sync    = TRUE,
      target  = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   response <- .rs.api.sendRequest(request)
   response$id
   
})

.rs.addApiFunction("documentContents", function(id = NULL) {
   
   # resolve id
   id <- .rs.nullCoalesce(id, .rs.api.documentId(allowConsole = FALSE))
   
   # retrieve properties
   properties <- .Call("rs_documentProperties",
                       as.character(id),
                       TRUE,
                       PACKAGE = "(embedding)")
   
   # extract contents as UTF-8
   contents <- properties$contents
   Encoding(contents) <- "UTF-8"
   
   # return
   contents
})

.rs.addApiFunction("documentPath", function(id = NULL) {
   
   # resolve document id
   id <- .rs.nullCoalesce(id, .rs.api.documentId(allowConsole = FALSE))
   if (is.null(id))
      return(NULL)
   
   # read document properties
   properties <- .Call("rs_documentProperties",
                       id,
                       FALSE,
                       PACKAGE = "(embedding)")
   
   # return document path
   properties$path
   
})

.rs.addApiFunction("getAllOpenDocuments", function(includeContents = TRUE) {
   
   # get all open documents
   documents <- .Call("rs_getAllOpenDocuments",
                      as.logical(includeContents),
                      PACKAGE = "(embedding)")
   
   # return documents list (or empty list if NULL)
   if (is.null(documents)) {
      return(list())
   }
   
   return(documents)
})

.rs.addApiFunction("documentSave", function(id = NULL) {
   
   # resolve document id
   id <- .rs.nullCoalesce(id, .rs.api.documentId(allowConsole = FALSE))
   if (is.null(id))
      return(TRUE)
   
   # attempt document save
   .Call("rs_requestDocumentSave", id, PACKAGE = "(embedding)")
   
})

.rs.addApiFunction("documentSaveAll", function() {
   .Call("rs_requestDocumentSave", NULL, PACKAGE = "(embedding)")
})

.rs.addApiFunction("documentNew", function(type,
                                           code,
                                           row = 0,
                                           column = 0,
                                           execute = FALSE)
{
   type <- switch(
      type,
      rmd       = "r_markdown",
      rmarkdown = "r_markdown",
      sql       = "sql",
      "r_script"
   )

   payload <- list(
      type    = .rs.scalar(type),
      code    = .rs.scalar(paste(code, collapse = "\n")),
      row     = .rs.scalar(as.integer(row)),
      column  = .rs.scalar(as.integer(column)),
      execute = .rs.scalar(execute)
   )
   
   request <- .rs.api.createRequest(
      type = .rs.api.eventTypes$TYPE_DOCUMENT_NEW,
      sync = TRUE,
      target = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   response <- .rs.api.sendRequest(request)
   response$id
})

.rs.addApiFunction("documentOpen", function(path, 
                                            line = -1L, 
                                            col = -1L, 
                                            moveCursor = TRUE) {

   # validate path argument
   hasFile <- !is.null(path) && length(path) > 0
   if (hasFile && !is.character(path)) {
      stop("path must be a character")
   }
   if (length(path) > 1L) {
      stop("path must be a single file")
   }
   if (hasFile && !file.exists(path)) {
      stop(path, " does not exist.")
   }
   
   if (hasFile)
   {
      # expand and alias for client
      path <- .rs.normalizePath(path, winslash = "/", mustWork = TRUE)
      path <- .rs.createAliasedPath(path)
   }

   # transform numeric line, column values to integer
   if (is.double(line))
      line <- as.integer(line)
   
   if (is.double(col))
      col <- as.integer(col)

   # validate line/col arguments
   if (!is.integer(line) || length(line) != 1 ||
       !is.integer(col)  || length(col) != 1) {
      stop("line and column must be numeric values.")
   }

   payload <- list(
      path = .rs.scalar(path), 
      row = .rs.scalar(line), 
      column = .rs.scalar(col), 
      moveCursor = .rs.scalar(isTRUE(moveCursor))
   )
   
   request <- .rs.api.createRequest(
      type   = .rs.api.eventTypes$TYPE_DOCUMENT_OPEN,
      sync   = TRUE,
      target = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   response <- .rs.api.sendRequest(request)
   response$id
   
})

.rs.addApiFunction("documentClose", function(id = NULL, save = TRUE) {
   
   # resolve document id
   id <- .rs.nullCoalesce(id, .rs.api.documentId(allowConsole = FALSE))
   if (is.null(id))
      return(TRUE)
   
   # request close
   .Call("rs_requestDocumentClose", id, save, PACKAGE = "(embedding)")
   
})

.rs.addApiFunction("closeAllSourceBuffersWithoutSaving", function() {
   .Call("rs_documentCloseAllNoSave", PACKAGE = "(embedding)")
})

# NOTE: we allow '1L' just in case for backwards compatibility
# with older preferences not migrated to the newer string version
.rs.addApiFunction("getConsoleHasColor", function(name) {
   mode <- .rs.readUiPref("ansi_console_mode")
   !is.null(mode) && mode %in% list(1L, "on")
})

.rs.addApiFunction("terminalSend", function(id, text) {
   if (!is.character(text))
      stop("'text' should be a character vector", call. = FALSE)

   if (is.null(id) || !is.character(id) || length(id) != 1)
      stop("'id' must be a character vector of length one")

  .Call("rs_terminalSend", id, text)
   invisible(NULL)
})

.rs.addApiFunction("terminalClear", function(id) {
   if (is.null(id) || !is.character(id) || length(id) != 1)
      stop("'id' must be a character vector of length one")

  .Call("rs_terminalClear", id)
  invisible(NULL)
})

.rs.addApiFunction("terminalCreate", function(caption = NULL, show = TRUE, shellType = NULL) {
   if (!is.null(caption) && (!is.character(caption) || (length(caption) != 1)))
      stop("'caption' must be NULL or a character vector of length one")

   if (is.null(show) || !is.logical(show))
      stop("'show' must be a logical vector")

   if (!is.null(shellType) && (!is.character(shellType) || (length(shellType) != 1)))
      stop("'shellType' must be NULL or a character vector of length one")

   validShellType = TRUE
   if (!is.null(shellType)) {
      validShellType <- tolower(shellType) %in% c("default", "win-cmd", 
            "win-ps", "win-git-bash", "win-wsl-bash", "ps-core", "custom")
   }      
   if (!validShellType)
      stop("'shellType' must be NULL, or one of 'default', 'win-cmd', 'win-ps', 'win-git-bash', 'win-wsl-bash', 'ps-core', 'bash', 'zsh', or 'custom'.") 

   .Call("rs_terminalCreate", caption, show, shellType)
})

.rs.addApiFunction("terminalBusy", function(id) {
   if (is.null(id) || !is.character(id))
      stop("'id' must be a character vector")

   .Call("rs_terminalBusy", id)
})

.rs.addApiFunction("terminalRunning", function(id) {
   if (is.null(id) || !is.character(id))
      stop("'id' must be a character vector")

   .Call("rs_terminalRunning", id)
})

.rs.addApiFunction("terminalList", function() {
   .Call("rs_terminalList")
})

.rs.addApiFunction("terminalContext", function(id) {
   if (is.null(id) || !is.character(id) || (length(id) != 1))
      stop("'id' must be a single element character vector")

   .Call("rs_terminalContext", id)
})

.rs.addApiFunction("terminalActivate", function(id = NULL, show = TRUE) {
   if (!is.null(id) && (!is.character(id) || (length(id) != 1)))
      stop("'id' must be NULL or a character vector of length one")

   if (!is.logical(show))
     stop("'show' must be TRUE or FALSE")

   .Call("rs_terminalActivate", id, show)
   invisible(NULL)
})

.rs.addApiFunction("terminalBuffer", function(id, stripAnsi = TRUE) {
   if (is.null(id) || !is.character(id) || (length(id) != 1))
      stop("'id' must be a single element character vector")

   if (is.null(stripAnsi) || !is.logical(stripAnsi))
      stop("'stripAnsi' must be a logical vector")

   .Call("rs_terminalBuffer", id, stripAnsi)
})

.rs.addApiFunction("terminalKill", function(id) {
   if (is.null(id) || !is.character(id))
      stop("'id' must be a character vector")

   .Call("rs_terminalKill", id)
   invisible(NULL)
})

.rs.addApiFunction("terminalVisible", function() {
   .Call("rs_terminalVisible")
})

.rs.addApiFunction("terminalExecute", function(command,
                                               workingDir = NULL,
                                               env = character(),
                                               show = TRUE) {
   if (is.null(command) || !is.character(command) || (length(command) != 1))
      stop("'command' must be a single element character vector")
   if (!is.null(workingDir) && (!is.character(workingDir) || (length(workingDir) != 1)))
      stop("'workingDir' must be a single element character vector")
   if (!is.null(env) && !is.character(env))
      stop("'env' must be a character vector")
   if (is.null(show) || !is.logical(show))
      stop("'show' must be a logical vector")

   .Call("rs_terminalExecute", command, workingDir, env, show, PACKAGE = "(embedding)")
})

.rs.addApiFunction("terminalExitCode", function(id) {
   if (is.null(id) || !is.character(id) || (length(id) != 1))
      stop("'id' must be a single element character vector")

   .Call("rs_terminalExitCode", id, PACKAGE = "(embedding)")
})

options(terminal.manager = list(terminalActivate = .rs.api.terminalActivate,
                                terminalCreate = .rs.api.terminalCreate,
                                terminalClear = .rs.api.terminalClear,
                                terminalList = .rs.api.terminalList,
                                terminalContext = .rs.api.terminalContext,
                                terminalBuffer = .rs.api.terminalBuffer,
                                terminalVisible = .rs.api.terminalVisible,
                                terminalBusy = .rs.api.terminalBusy,
                                terminalRunning = .rs.api.terminalRunning,
                                terminalKill = .rs.api.terminalKill,
                                terminalSend = .rs.api.terminalSend,
                                terminalExecute = .rs.api.terminalExecute,
                                terminalExitCode = .rs.api.terminalExitCode))

.rs.addApiFunction("selectFile", function(
   caption = "Select File",
   label = "Select",
   path = .rs.getProjectDirectory(),
   filter = NULL,
   existing = TRUE)
{
   .Call("rs_openFileDialog",
         1L,
         caption,
         label,
         path,
         filter,
         existing,
         PACKAGE = "(embedding)")
})

.rs.addApiFunction("selectDirectory", function(
   caption = "Select Directory",
   label = "Select",
   path = .rs.getProjectDirectory())
{
   .Call("rs_openFileDialog",
         2L,
         caption,
         label,
         path,
         NULL,
         TRUE,
         PACKAGE = "(embedding)")
})

.rs.addApiFunction("getThemeInfo", function() {
   
   # read theme preferences
   global <- .rs.readUiPref("global_theme")

   theme <- .rs.readUserState("theme")
   if (is.null(theme))
      theme <- list("name" = "Textmate (default)", "isDark" = FALSE)

   global <- switch(
      if (is.null(global)) "" else global,
      alternate = "Sky",
      default = "Modern",
      "Classic"
   )

   # default/fallback theme colors 
   foreground <- "#000000";
   background <- "#FFFFFF";

   # attempt to read colors from browser
   colors <- .Call("rs_getThemeColors", PACKAGE = "(embedding)")
   if (!is.null(colors)) {
      foreground <- colors$foreground
      background <- colors$background
   }

   list(
      editor = theme$name,
      global = global,
      dark = theme$isDark,
      foreground = foreground,
      background = background
   )
})

.rs.addApiFunction("askForSecret", function(name, title, prompt) {
   .rs.askForSecret(name, title, prompt)
})

.rs.addApiFunction("previewSql", function(conn, statement, ...) {
   .rs.previewSql(conn, statement, ...)
})

.rs.addApiFunction("buildToolsCheck", function() {
   .Call("rs_canBuildCpp", PACKAGE = "(embedding)")
})

.rs.addApiFunction("buildToolsInstall", function(action) {
   
   # skip prompt if requested explicitly
   if (is.null(action) || !nzchar(action))
      return(.Call("rs_installBuildTools", PACKAGE = "(embedding)"))
   
   # otherwise, call prompting version
   .rs.installBuildTools(action)
})

.rs.addApiFunction("buildToolsExec", function(expr) {
   .rs.withBuildTools(expr)
})

.rs.addApiFunction("dictionariesPath", function() {
   .Call("rs_dictionariesPath", "bundled", PACKAGE = "(embedding)")
})

.rs.addApiFunction("bundledDictionariesPath", function() {
   .Call("rs_dictionariesPath", "bundled", PACKAGE = "(embedding)")
})

.rs.addApiFunction("extraDictionariesPath", function() {
   .Call("rs_dictionariesPath", "extra", PACKAGE = "(embedding)")
})

.rs.addApiFunction("userDictionariesPath", function() {
   .Call("rs_dictionariesPath", "user", PACKAGE = "(embedding)")
})

# translate a local URL into an externally accessible URL on RStudio Server
.rs.addApiFunction("translateLocalUrl", function(url, absolute = FALSE) {
  .Call("rs_translateLocalUrl", url, absolute, PACKAGE = "(embedding)")
})

# execute an arbitrary RStudio application command (AppCommand)
.rs.addApiFunction("executeCommand", function(commandId, quiet = FALSE) {
  .Call("rs_executeAppCommand", commandId, quiet, PACKAGE = "(embedding)")
})

# return a list of all the R packages RStudio depends on in in some way
.rs.addApiFunction("getPackageDependencies", function() {
  .Call("rs_packageDependencies", PACKAGE = "(embedding)")
})

# highlight UI elements within the IDE
.rs.addApiFunction("highlightUi", function(data = list()) {
   .Call("rs_highlightUi", data, PACKAGE = "(embedding)")
})

# return display username (user identity)
.rs.addApiFunction("userIdentity", function() {
   .Call("rs_userIdentity", PACKAGE = "(embedding)")
})

# return system username 
.rs.addApiFunction("systemUsername", function() {
   .Call("rs_systemUsername", PACKAGE = "(embedding)")
})

# store callback functions to be executed after a specified chunk
# and return a handle to unregister the chunk
.rs.addApiFunction("registerChunkCallback", function(chunkCallback) {

   if (length(.rs.notebookChunkCallbacks) != 0)
      stop("Callback is already registered.")
   if (!is.function(chunkCallback))
      stop("'chunkCallback' must be a function")
   if (length(formals(chunkCallback)) != 2)
      stop("'chunkCallback' must contain two parameters: chunkName and chunkCode")

   data <- chunkCallback
   handle <- .Call("rs_createUUID", PACKAGE = "(embedding)")
   assign(handle, value = data, envir = .rs.notebookChunkCallbacks)

   return(handle)
})

# unregister a chunk callback functions
.rs.addApiFunction("unregisterChunkCallback", function(id = NULL) {
   if (length(.rs.notebookChunkCallbacks) == 0)
      warning("No registered callbacks found")
   else if (!is.null(id) && !exists(id, envir = .rs.notebookChunkCallbacks))
      warning("Handle not found.")
   else
   {
      id <- ls(envir = .rs.notebookChunkCallbacks)
      rm(list = id, envir = .rs.notebookChunkCallbacks)
   }
})

# get list of command IDs which currently have callbacks (listeners) attached
.rs.addFunction("getCommandsWithCallbacks", function() {
   commands <- unique(sort(unlist(lapply(names(.rs.commandCallbacks), function(handle) {
      handler <- get(handle, envir = .rs.commandCallbacks)
      if (nzchar(handler$command)) 
         handler$command
      else
         ""
   }))))
   commands[nzchar(commands)]
})

# register a command callback
.rs.addApiFunction("registerCommandCallback", function(commandId, commandCallback) {

   # validate arguments
   if (!nzchar(commandId))
      stop("'commandId' must be a character vector naming an RStudio command ID")
   if (!is.function(commandCallback))
      stop("'commandCallback' must be a function")

   # find a unique ID for this callback
   repeat {
      handle <- .Call("rs_generateShortUuid", PACKAGE = "(embedding)")
      if (!(handle %in% names(.rs.commandCallbacks)))
         break
   } 

   # save the ID along with the registered callback
   assign(handle, 
          value = list(
            command = commandId,
            callback = commandCallback),
          envir = .rs.commandCallbacks)

   # send event to client indicating which command IDs currently have callbacks registered
   .rs.enqueClientEvent("command_callbacks_changed", 
                        .rs.scalarListFromList(as.list(.rs.getCommandsWithCallbacks())))

   # return the handle we created
   handle 
})

# unregister a command callback
.rs.addApiFunction("unregisterCommandCallback", function(handle = NULL) {
   if (!is.null(handle) && !exists(handle, envir = .rs.commandCallbacks))
      warning("Handle '", handle, " is not a registered RStudio command callback.")
   else {
      rm(list = handle, envir = .rs.commandCallbacks)

      # send event to client indicating which command IDs currently have callbacks registered
      .rs.enqueClientEvent("command_callbacks_changed", 
                           .rs.scalarListFromList(as.list(.rs.getCommandsWithCallbacks())))

   }

   invisible(NULL)
})

# records the execution of a command
.rs.addJsonRpcHandler("record_command_execution", function(commandId) {
   # loop over all registered command callbacks
   for (handle in names(.rs.commandCallbacks)) {

      # retrieve handler metadata
      handler <- get(handle, envir = .rs.commandCallbacks)
      
      # sanity check: ensure this handler looks properly formatted. nothing else should be writing
      # to this environment, but if it does we don't want it to trip up the processing below.
      if (!is.list(handler)) {
         next
      }
      if (!is.function(handler$callback)) {
         next
      }

      # if this is a stream listener for all commands ("*"), invoke it with the command ID
      if (identical(handler$command, "*")) {
         handler$callback(commandId)
         next
      }

      # if this is a listener for a specific command, invoke it without arguments
      if (identical(handler$command, commandId)) {
         handler$callback()
      }
   }
})


# Tutorial ----

# invoked by rstudioapi to instruct RStudio to open a particular
# URL in the Tutorial pane. should be considered an internal contract
# between the RStudio + rstudioapi packages rather than an official
# user-facing API
.rs.addApiFunction("tutorialLaunchBrowser", function(url) {
   .rs.tutorial.launchBrowser(url)
})

# given a tutorial 'name' from package 'package', run that tutorial
# and show the application in the Tutorial pane
.rs.addApiFunction("tutorialRun", function(name, package, shiny_args = NULL) {
   .rs.tutorial.runTutorial(name, package, shiny_args)
})

# stop a running tutorial
.rs.addApiFunction("tutorialStop", function(name, package) {
   .rs.tutorial.stopTutorial(name, package)
})

# API for sending + receiving arbitrary requests from rstudioapi
# added in RStudio v1.4; not used universally by older APIs but useful
# as a framework for any new functions that might be added

#' @param type The event type. See '.rs.api.events' for the set
#'   of permissible targets.
#' 
#' @param sync Boolean; does handling of this event need to be
#'   synchronous? Ensure `sync = TRUE` is used if you need to wait
#'   for a response from the client.
#'
#' @param target The window to be targeted by this request. See
#'   `.rs.api.eventTargets` for possible targets.
#'
#' @param data The payload associated with this event.
#'
.rs.addApiFunction("createRequest", function(type, sync, target, payload)
{
   list(
      type    = .rs.scalar(type),
      sync    = .rs.scalar(sync),
      target  = .rs.scalar(target),
      payload = as.list(payload)
   )
})

.rs.addApiFunction("sendRequest", function(request) {
   .Call("rs_sendApiRequest", request, PACKAGE = "(embedding)")
})

.rs.addApiFunction("selectionGet", function(id = NULL)
{
   # create data payload
   payload <- list(
      doc_id = .rs.scalar(id)
   )
   
   # create request
   request <- .rs.api.createRequest(
      type    = .rs.api.eventTypes$TYPE_GET_EDITOR_SELECTION,
      sync    = TRUE,
      target  = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   # fire away
   .rs.api.sendRequest(request)
})

.rs.addApiFunction("selectionSet", function(value = NULL, id = NULL)
{
   # collapse value into single string
   value <- paste(value, collapse = "\n")
   
   # create data payload
   payload <- list(
      value  = .rs.scalar(value),
      doc_id = .rs.scalar(id)
   )
   
   # create request
   request <- .rs.api.createRequest(
      type    = .rs.api.eventTypes$TYPE_SET_EDITOR_SELECTION,
      sync    = TRUE,
      target  = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   # fire away
   .rs.api.sendRequest(request)
})

.rs.addApiFunction("filesPaneNavigate", function(path)
{
   info <- file.info(path, extra_cols = FALSE)
   if (is.na(info$isdir))
      stop("'", path, "' does not exist")
   else if (identical(info$isdir, FALSE))
      path <- dirname(path)
   
   payload <- list(
      path  = .rs.scalar(.rs.createAliasedPath(path))
   )
   
   request <- .rs.api.createRequest(
      type    = .rs.api.eventTypes$TYPE_FILES_PANE_NAVIGATE,
      sync    = FALSE,
      target  = .rs.api.eventTargets$TYPE_UNKNOWN,
      payload = payload
   )
   
   .rs.api.sendRequest(request)
   invisible(path)
})

.rs.addApiFunction("bugReport", function()
{
   .rs.bugReport(pro = FALSE)
})

.rs.addApiFunction("setGhostText", function(text)
{
   text <- paste(enc2utf8(text), collapse = "\n")
   payload <- list(text = .rs.scalar(text))
   request <- .rs.api.createRequest(
      type    = .rs.api.eventTypes$TYPE_SET_GHOST_TEXT,
      sync    = TRUE,
      target  = .rs.api.eventTargets$TYPE_ACTIVE_WINDOW,
      payload = payload
   )
   
   .rs.api.sendRequest(request)
   invisible(text)
})

