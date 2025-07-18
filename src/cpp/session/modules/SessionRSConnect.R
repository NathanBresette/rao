#
# SessionRSConnect.R
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

.rs.addJsonRpcHandler("get_deployment_env_vars", function()
{
   as.character(names(Sys.getenv()))
})

.rs.addJsonRpcHandler("forget_rsconnect_deployments", function(sourcePath, outputPath)
{
  # for R files, assume that the containing directory is treated as the
  # application path as opposed to the file itself
  ext <- tolower(tools::file_ext(sourcePath))
  if (identical(ext, "r"))
    sourcePath <- dirname(sourcePath)

  rsconnect::forgetDeployment(appPath = sourcePath, force = TRUE)
})

# this is a clone of 'applicationConfigDir' in the rsconnect package; we use it
# to detect the condition in which rsconnect has state but the package itself
# isn't installed.
.rs.addFunction("connectConfigDir", function(appName, subDir = NULL) {

  # get the home directory from the operating system (in case
  # the user has redefined the meaning of ~) but fault back
  # to ~ if there is no HOME variable defined
  homeDir <- Sys.getenv("HOME", unset="~")

  # determine application config dir (platform specific)
  sysName <- Sys.info()[['sysname']]
  if (identical(sysName, "Windows"))
    configDir <- Sys.getenv("APPDATA")
  else if (identical(sysName, "Darwin"))
    configDir <- file.path(homeDir, "Library/Application Support")
  else
    configDir <- Sys.getenv("XDG_CONFIG_HOME", file.path(homeDir, ".config"))

  # append the application name and optional subdir
  configDir <- file.path(configDir, "R", appName)
  if (!is.null(subDir))
    configDir <- file.path(configDir, subDir)

  # normalize path
  configDir <- normalizePath(configDir, mustWork=FALSE)

  # ensure that it exists
  if (!file.exists(configDir))
    dir.create(configDir, recursive=TRUE)

  # return it
  configDir
})

.rs.addFunction("scalarListFromFrame", function(frame)
{
   ret <- list()

   # return an empty list when no entries exist
   if (is.null(frame))
     return(ret)

   cols <- names(frame)

   # take apart the frame and compose a list of scalars from each row
   for (i in seq_len(nrow(frame))) {
      row <- lapply(cols,
                    function(col) { if (is.null(frame[i,col])) NULL
                                    else .rs.scalar(unlist(frame[i,col])) })
      names(row) <- cols
      ret[[i]] <- row
   }
   return(ret)
})

.rs.addFunction("getRSConnectDeployments", function(path, rpubsUploadId) {
   # start with an empty list
   deploymentsFrame <- data.frame(
     name = character(0),
     account = character(0),
     server = character(0),
     bundleId = character(0),
     appId = character(0),
     asStatic = logical(0),
     hostUrl = character(0),
     username = character(0),
     when = numeric(0))
   deployments <- list()
   servers <- data.frame(
     name = character(0),
     url = character(0))
   accounts <- data.frame(
     name = character(0),
     server = character(0))

   # attempt to populate the list from rsconnect; this can throw if e.g. the
   # package is not installed. in the case of any error we'll safely return
   # an empty list, or a stored RPubs upload ID if one was given (below)
   tryCatch({
     # included "orphaned" deployments; we will filter later
     deploymentsFrame <- rsconnect::deployments(appPath = path, excludeOrphaned = FALSE)
     deployments <- .rs.scalarListFromFrame(deploymentsFrame)

     # create the list of servers and accounts (for later filtering)
     servers <- rsconnect::servers()
     accounts <- rsconnect::accounts()
   }, error = function(e) { })

   # cross-reference registered servers against the list of deployments, so the
   # client knows without issuing a separate RPC which deployments don't have
   # registered servers
   if (nrow(deploymentsFrame) > 0) {
     # filter the list of servers by those that actually have accounts
     # registered
     servers <- servers[
         as.character(servers$name) %in% as.character(accounts$server),]

     # extract names and URLs from the remaining servers (include the virtual server rpubs.com)
     urls <- as.character(servers[["url"]])
     names <- c(as.character(servers[["name"]]), "rpubs.com")

     # compute whether the deployment is orphaned; note that this differs from
     # the definition of "orphaned" used by the rsconnect package in that it
     # considers only the server (not the account)
     deploymentsFrame <- cbind(deploymentsFrame, list(
       serverRegistered = as.character(deploymentsFrame[["server"]]) %in% names |
                          as.character(deploymentsFrame[["hostUrl"]]) %in% urls))

     # rebuild list with additional metadata
     deployments <- .rs.scalarListFromFrame(deploymentsFrame)
   }

   # no RPubs upload IDs to consider
   if (!is.character(rpubsUploadId) || nchar(rpubsUploadId) == 0) {
     return(deployments)
   }

   # if there's already a deployment to rpubs.com, ignore legacy deployment
   if ("rpubs.com" %in% deployments$server) {
     return(deployments)
   }

   # create a new list with the same names as the one we're about to return,
   # and populate the fields we know from RPubs. leave all others, including
   # user-defined fields, blank; this allows us to tolerate changes to the
   # deployment frame format.
   rpubsDeployment <- list()
   for (col in colnames(deploymentsFrame)) {
     if (col == "name")
       rpubsDeployment[col] = ""
     else if (col == "account")
       rpubsDeployment[col] = "rpubs"
     else if (col == "server")
       rpubsDeployment[col] = "rpubs.com"
     else if (col == "appId")
       rpubsDeployment[col] = rpubsUploadId
     else if (col == "bundleId")
       rpubsDeployment[col] = rpubsUploadId
     else if (col == "asStatic")
       rpubsDeployment[col] = TRUE
     else if (col == "when")
       rpubsDeployment[col] = 0
     else if (col == "hostUrl")
       rpubsDeployment[col] = "rpubs.com"
     else if (col == "username")
       rpubsDeployment[col] = "rpubs"
     else
       rpubsDeployment[col] = NA
   }

   # combine the deployments rsconnect knows about with the deployments we know
   # about
   c(deployments, list(.rs.scalarListFromList(rpubsDeployment)))
})

.rs.addJsonRpcHandler("get_rsconnect_account_list", function()
{
   accountList <- tryCatch(
     .rs.rsconnect.getAccountList(),
     error = function(e) NULL
   )
   
   .rs.scalarListFromFrame(accountList)
})

.rs.addFunction("rsconnect.getAccountList", function()
{
  accountList <- rsconnect::accounts()
  
  # if raw characters (older rsconnect), presume shinyapps.io
  if (is.character(accountList))
  {
    accountList <- data.frame(
      name   = accountList,
      server = "shinyapps.io"
    )
  }
  
  accountList
  
})

.rs.addJsonRpcHandler("remove_rsconnect_account", function(account, server) {
   rsconnect::removeAccount(name = account, server = server)
})

.rs.addJsonRpcHandler("get_rsconnect_app_list", function(account, server) {
   .rs.scalarListFromFrame(rsconnect::applications(account = account, server = server))
})

.rs.addJsonRpcHandler("get_rsconnect_app", function(id, account, server, hostUrl) {
  
  # retrieve application associated with these parameters
  app <- tryCatch(
    rsconnect:::getAppById(id, account, server, hostUrl),
    error = identity
  )
  
  # check for and return errors
  if (inherits(app, "error")) {
    message <- paste(conditionMessage(app), collapse = "\n")
    return(list(app = NULL, error = .rs.scalar(message)))
  }
  
  # if no such application is available, just return an empty list
  if (length(app) == 0L) {
    return(list(app = NULL, error = NULL))
  }
  
  # infer the configuration URL for this application
  app$config_url <- if (rsconnect:::isConnectServer(server)) {
    prefix <- sub("/__api__", "", hostUrl)
    paste(prefix, "connect/#/apps", app$id, sep = "/")
  } else {
    prefix <- "https://www.shinyapps.io/admin/#/applications"
    paste(prefix, app$id, sep = "/")
  }
  
  # try and get environment variables for this deployment (if available)
  app$envVars <- .rs.rsconnect.getApplicationEnvVars(
    server  = server,
    account = account,
    guid    = app$guid
  )
  
  list(
    app = .rs.scalarListFromList(app),
    error = NULL
  )

})

.rs.addJsonRpcHandler("validate_server_url", function(url) {
   # suppress output when validating server URL
   # (timeouts otherwise emitted to console)
   capture.output(serverInfo <- rsconnect:::validateServerUrl(url = url))
   .rs.scalarListFromList(serverInfo)
})

.rs.addJsonRpcHandler("get_auth_token", function(name) {
   .rs.scalarListFromList(rsconnect:::getAuthToken(server = name))
})

.rs.addJsonRpcHandler("get_user_from_token", function(url, token, privateKey) {
   user <- rsconnect:::getUserFromRawToken(serverUrl = url, token = token, privateKey = privateKey)
   .rs.scalarListFromList(user)
})

.rs.addJsonRpcHandler("register_user_token", function(serverName, accountName,
   userId, token, privateKey) {
  rsconnect:::registerUserToken(serverName = serverName, accountName = accountName, userId = userId,
                                token = token, privateKey = privateKey)
})

.rs.addJsonRpcHandler("get_rsconnect_lint_results", function(target) {
   err <- ""
   results <- NULL
   basePath <- ""

   # validate and lint the requested target
   if (!file.exists(target)) {
     err <- paste("The file or directory ", target, " does not exist.")
   } else {
     tryCatch({
       info <- file.info(target)
       if (info$isdir) {
         # a directory was specified--lint the whole thing
         basePath <- target
         results <- rsconnect::lint(project = basePath)
       } else if (tolower(tools::file_ext(target)) == "r") {
         # a single-file Shiny app--lint the directory (with file hint)
         basePath <- dirname(target)
         results <- rsconnect::lint(project = basePath, appPrimaryDoc = basename(target))
       } else {
         # a single file was specified--lint just that file
         basePath <- dirname(target)
         results <- rsconnect::lint(project = basePath, files = basename(target))
       }
    }, error = function(e) {
      err <<- e$message
    })
  }

  # empty or missing results; no need to do further work
  if (identical(length(results), 0) || !rsconnect:::hasLint(results)) {
    return(list(
      has_lint = .rs.scalar(FALSE),
      error_message = .rs.scalar(err)))
  }

  # we have a list of lint results; convert them to markers and emit them to
  # the Markers pane
  rsconnect:::showRstudioSourceMarkers(basePath = basePath, results)

  # return the result to the client
  list(
    has_lint = .rs.scalar(TRUE),
    error_message = .rs.scalar(err))
})

.rs.addFunction("docDeployList", function(target, asMultipleDoc, quartoSrcFile) {
  file_list <- c()
  target <- normalizePath(target, winslash = "/")

  # if deploying multiple documents, find all the files in the with a matching
  # extension; otherwise, just use the single document we were given
  if (asMultipleDoc) {
    targets <- list.files(path = dirname(target),
      pattern = glob2rx(paste("*", tools::file_ext(target), sep = ".")),
      ignore.case = TRUE, full.names = TRUE)
  } else {
    targets <- target
  }

  yaml <- NULL

  # check for a known encoding
  encoding <- getOption("encoding")
  properties <- .rs.getSourceDocumentProperties(target)
  if (!is.null(properties$encoding))
     encoding <- properties$encoding

  # attempt to parse yaml front matter
  yaml <- tryCatch(
     rmarkdown::yaml_front_matter(target, encoding = encoding),
     error = function(e) NULL
  )

  # if this failed, try again as UTF-8
  if (is.null(yaml) && !identical(encoding, "UTF-8"))
  {
     yaml <- tryCatch(
        rmarkdown::yaml_front_matter(target, encoding = "UTF-8"),
        error = function(e) NULL
     )
  }

  # check to see if the target has "runtime: shiny/prerendred", if so then
  # return a full directory deploy list
  if (is.list(yaml) && (identical(yaml$runtime, "shiny_prerendered") ||
                        identical(yaml$runtime, "shinyrmd") ||
                        identical(yaml$server, "shiny") ||
                        (is.list(yaml$server) && identical(yaml$server$type, "shiny"))
                       )
     )
  {
    return(rsconnect::listBundleFiles(appDir = dirname(target)))
  }

  # find the resources used by each document
  for (t in targets) {
    deploy_frame <- NULL
    tryCatch({
      # this operation can be expensive and could also throw if e.g. the
      # document fails to parse or render
      deploy_frame <- rmarkdown::find_external_resources(t)
    },
    error = function(e) {
      # errors are not fatal here; we just might miss some resources, which
      # the user will have to add manually
    })
    if (!is.null(deploy_frame)) {
      file_list <- c(file_list, deploy_frame$path)
    }
    file_list <- c(file_list, basename(t))
  }

  if (nzchar(quartoSrcFile)) {
    # query quarto for project and resources
    quartoSrcFile <- normalizePath(quartoSrcFile, winslash = "/")
    project <- .rs.quartoFileProject(quartoSrcFile)
    resources <- project$resources
    project <- project$project

    # query quarto for resources
    file_list <- c(file_list, resources)

    # per-directory option may be given in _metadata.yml
    if (file.exists(file.path(dirname(quartoSrcFile), "_metadata.yml"))) {
      file_list <- c(file_list, "_metadata.yml")
    }

    if (length(project)) {
      if (identical(project, "")) {
        file_list <- c(file_list, "_quarto.yml")
      } else {
        file_list <- c(file_list, file.path(project, "_quarto.yml"))
      }
    }
  }

  # discard any duplicates (the same resource may be depended upon by multiple
  # R Markdown documents)
  file_list <- unique(file_list)

  # compose the result
  list(
    contents = file_list,
    totalSize = sum(
       file.info(file.path(dirname(target), file_list))$size))
})

.rs.addFunction("makeDeploymentList", function(target, asMultipleDoc,
                                               quartoSrcFile, max_size) {
   ext <- tolower(tools::file_ext(target))
   if (ext %in% c("qmd", "rmd", "html", "htm", "md"))
     .rs.docDeployList(target, asMultipleDoc, quartoSrcFile)
   else
     rsconnect::listBundleFiles(appDir = target)
})

.rs.addFunction("quartoFileResources", function(target) {
   .Call("rs_quartoFileResources", target)
})

.rs.addFunction("quartoFileProject", function(target) {
   .Call("rs_quartoFileProject", basename(target), dirname(target), PACKAGE = "(embedding)")
})

# Given a list of files of the form:
#
# file2.ext
# dir/file1.ext
# dir/file2.ext
# dir/file3.ext
# dir/subdir/file4.ext
# dir2/file2.ext
#
# and a threshold, collapses all directories that contain more than the threshold
# number of files. For instance, if threshold = 2, the result from the above
# would be:
#
# file2.ext
# dir2/file2.ext
# dir/

.rs.addFunction("summarizeDir", function(files, threshold) {
  # extract the subdir using a regex
  prefixes <- regexec("^([^/])+/", files)

  # extract the matching text to form a list of top-level subdirs; skip files
  # with no prefix
  prefixes <- lapply(regmatches(x = files, m = prefixes), `[`, 1)
  prefixes[is.na(prefixes)] <- ""

  # get a list of top-level directories
  toplevel <- sort(unlist(prefixes))

  # get a count of the number of files in each top-level dir
  counts <- rle(toplevel)

  # for those dirs which have more than the threshold, hide all of the contents
  rollups <- which(counts$lengths > threshold)
  include <- rep_len(TRUE, length(files))
  for (rollup in rollups) {
    if (nzchar(counts$values[rollup]))
       include <- include & prefixes != counts$values[rollup]
  }

  # combine the files to be included with the top-level directories that were
  # rolled up
  toplevel <- counts$values[rollups]
  c(files[include], toplevel[nzchar(toplevel)])
})

.rs.addFunction("rsconnectDeployList", function(target, asMultipleDoc, quartoSrcFile) {
  max_size <- getOption("rsconnect.max.bundle.size", 1048576000)
  dirlist <- .rs.makeDeploymentList(target, asMultipleDoc, quartoSrcFile, max_size)

  list (
    # if the directory is too large, no need to bother sending a potentially
    # large blob of data to the client
    dir_list = if (dirlist$totalSize >= max_size)
                  NULL
               else
                  .rs.summarizeDir(dirlist$contents, 5),
    max_size = .rs.scalar(max_size),
    dir_size = .rs.scalar(dirlist$totalSize))
})

.rs.addFunction("enableRStudioConnectUI", function(enable) {
  .rs.enqueClientEvent("enable_rstudio_connect", enable);
  message("Publishing UI ", if (enable) "enabled" else "disabled", ".")
  invisible(enable)
})

.rs.addFunction("hasConnectAccount", function() {
   tryCatch({
      # check for any non-shinyapps.io accounts
      accounts <- rsconnect::accounts()
      subset(accounts, !(server %in% c("shinyapps.io", "rstudio.cloud", "posit.cloud")))
      .rs.scalar(nrow(accounts) > 0)
   }, error = function(e) { FALSE })
})


.rs.addJsonRpcHandler("get_deployment_files", function(target, asMultipleDoc, quartoSrcFile) {
  .rs.rsconnectDeployList(target, asMultipleDoc, quartoSrcFile)
})

# The parameter to this function is a string containing the R command from
# the rsconnect service; we just need to parse and execute it directly.
# The client is responsible for verifying that the statement corresponds to
# a valid ::setAccountInfo command.
.rs.addJsonRpcHandler("connect_rsconnect_account", function(accountCmd) {
   cmd <- parse(text=accountCmd)
   eval(cmd, envir = globalenv())
})


.rs.addFunction("getRmdPublishDetails", function(target, encoding) {

  # read yaml
  lines <- readLines(target, encoding = encoding, warn = FALSE)
  frontMatter <- rmarkdown:::parse_yaml_front_matter(lines)

  # if this is runtime: shiny_prerendered then is_multi_rmd is FALSE
  if (is.list(frontMatter) &&
      (identical(frontMatter$runtime, "shiny_prerendered") ||
       identical(frontMatter$runtime, "shinyrmd") ||
       identical(frontMatter$server, "shiny") ||
       (is.list(frontMatter$server) && identical(frontMatter$server$type, "shiny")))) {
    is_multi_rmd <- FALSE
  } else {
    # check for multiple R Markdown documents in the directory
    rmds <- list.files(path = dirname(target), pattern = glob2rx("*.Rmd"),
                       all.files = FALSE, recursive = FALSE, ignore.case = TRUE,
                       include.dirs = FALSE)
    is_multi_rmd <- length(rmds) > 1
  }

  # see if this format is self-contained (defaults to true for HTML-based
  # formats)
  selfContained <- TRUE
  outputFormat <- rmarkdown:::output_format_from_yaml_front_matter(lines)
  if (is.list(outputFormat$options) &&
      identical(outputFormat$options$self_contained, FALSE)) {
    selfContained <- FALSE
  }

  # extract the document's title
  title <- ""
  if (is.list(frontMatter) && is.character(frontMatter$title)) {
    title <- frontMatter$title
  }

  # check to see if this is an interactive doc (i.e. needs to be run rather
  # rather than rendered)
  renderFunction <- .rs.getCustomRenderFunction(target)

  list(
    is_multi_rmd        = .rs.scalar(is_multi_rmd),
    is_shiny_rmd        = .rs.scalar(renderFunction == "rmarkdown::run"),
    is_self_contained   = .rs.scalar(selfContained),
    title               = .rs.scalar(title),
    has_connect_account = .rs.scalar(.rs.hasConnectAccount()))
})

# indicates whether there appear to be accounts registered on the system that
# cannot be used because the rsconnect package isn't installed
.rs.addJsonRpcHandler("has_orphaned_accounts", function() {
  # get the folder in which we expect account data to exist
  accountDir <- .rs.connectConfigDir("rsconnect", "accounts")

  # if this folder doesn't exist, check the old location
  if (!file.exists(accountDir))
    accountDir <- .rs.connectConfigDir("connect", "accounts")

  # if we found a config folder, list all regular files (not directories) inside
  # it
  if (file.exists(accountDir)) {
    files <- list.files(accountDir, recursive = TRUE, include.dirs = FALSE)

    # if there are files and the rsconnect package isn't installed at all,
    # consider those files to correspond to orphaned accounts
    if (length(files) > 0 && !.rs.isPackageInstalled("rsconnect")) {
      return(.rs.scalar(length(files)))
    }
  }

  return(.rs.scalar(0))
})

.rs.addJsonRpcHandler("get_server_urls", function() {
  servers <- rsconnect::servers()

  # convert from factors if necessary
  for (col in c("name", "url")) {
    if (col %in% colnames(servers)) {
      servers[[col]] <- as.character(servers[[col]])
    }
  }
  .rs.scalarListFromFrame(servers)
})

.rs.addJsonRpcHandler("generate_app_name", function(appTitle, appPath, account) {
  name  <- ""
  valid <- TRUE
  error <- ""

  # attempt to generate a name from the title
  tryCatch({
    name <- rsconnect::generateAppName(appTitle = appTitle,
                                       appPath  = appPath,
                                       account  = account)
  }, error = function(e) {
    valid <<- FALSE
    error <<- e$message
  })

  # report result
  list(name  = .rs.scalar(name),
       valid = .rs.scalar(valid),
       error = .rs.scalar(error))
})

.rs.addFunction("rsconnect.getApplicationEnvVars", function(server, account, guid)
{
  tryCatch(
    .rs.rsconnect.getApplicationEnvVarsImpl(server, account, guid),
    error = function(e) character()
  )
})

.rs.addFunction("rsconnect.getApplicationEnvVarsImpl", function(server, account, guid)
{
  rsconnect <- asNamespace("rsconnect")
  accountDetails <- rsconnect$accountInfo(account, server)
  client <- rsconnect$clientForAccount(accountDetails)
  client$getEnvVars(guid)
})

.rs.addFunction("findEnvironFile", function()
{
   environFile <- Sys.getenv("R_ENVIRON_USER", unset = NA)
   if (!is.na(environFile))
      return(environFile)
   
   project <- .rs.getProjectDirectory()
   if (!is.null(project))
   {
      projectEnviron <- file.path(project, ".Renviron")
      if (file.exists(projectEnviron))
         return(projectEnviron)
   }
   
   userEnviron <- path.expand("~/.Renviron")
   if (file.exists(userEnviron))
      return(userEnviron)
   
   ""
})
