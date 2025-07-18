#
# globals.cmake
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

# include guard
if(RSTUDIO_CMAKE_GLOBALS_INCLUDED)
   return()
endif()
set(RSTUDIO_CMAKE_GLOBALS_INCLUDED YES)

# helper for detecting Linux
if(CMAKE_SYSTEM_NAME STREQUAL Linux)
   set(LINUX TRUE CACHE INTERNAL "")
endif()

# read /etc/os-release
if(LINUX)
   include(OsRelease)
endif()

# version info
if ("$ENV{RSTUDIO_VERSION_MAJOR}" STREQUAL "")
  string(TIMESTAMP CPACK_PACKAGE_VERSION_MAJOR "%Y")
  set(RSTUDIO_UNVERSIONED_BUILD TRUE)
else()
  set(CPACK_PACKAGE_VERSION_MAJOR $ENV{RSTUDIO_VERSION_MAJOR})
endif()
if ("$ENV{RSTUDIO_VERSION_MINOR}" STREQUAL "")
   string(TIMESTAMP CPACK_PACKAGE_VERSION_MINOR "%m")
else()
  set(CPACK_PACKAGE_VERSION_MINOR $ENV{RSTUDIO_VERSION_MINOR})
endif()
if ("$ENV{RSTUDIO_VERSION_PATCH}" STREQUAL "")
  set(CPACK_PACKAGE_VERSION_PATCH "999")
else()
  set(CPACK_PACKAGE_VERSION_PATCH $ENV{RSTUDIO_VERSION_PATCH})
endif()
if ("$ENV{RSTUDIO_VERSION_SUFFIX}" STREQUAL "" OR "$ENV{RSTUDIO_VERSION_SUFFIX}" STREQUAL " ")
  if(DEFINED ENV{RSTUDIO_VERSION_SUFFIX})
    # If the environment variable is defined but empty/space, use empty
    set(CPACK_PACKAGE_VERSION_SUFFIX "")
  else()
    # If the environment variable is not defined at all, use default
    set(CPACK_PACKAGE_VERSION_SUFFIX "-dev+999")
  endif()
else()
  set(CPACK_PACKAGE_VERSION_SUFFIX $ENV{RSTUDIO_VERSION_SUFFIX})
endif()
set(CPACK_PACKAGE_VERSION "${CPACK_PACKAGE_VERSION_MAJOR}.${CPACK_PACKAGE_VERSION_MINOR}.${CPACK_PACKAGE_VERSION_PATCH}${CPACK_PACKAGE_VERSION_SUFFIX}")

string(TIMESTAMP CPACK_COPYRIGHT_YEAR "%Y")
string(TIMESTAMP CPACK_BUILD_DATE "%Y-%m-%d")

# create numeric format for major version (needed when version must be strictly numeric)
set(CPACK_PACKAGE_VERSION_MAJOR_NUMERIC "${CPACK_PACKAGE_VERSION_MAJOR}${CPACK_PACKAGE_VERSION_MINOR}")
message(STATUS "Building RStudio ${CPACK_PACKAGE_VERSION}")

# detect pro builds
if(EXISTS "${RSTUDIO_PROJECT_ROOT}/upstream")
   set(RSTUDIO_PRO_BUILD 1)
else()
   set(RSTUDIO_PRO_BUILD 0)
endif()

if (NOT DEFINED RSTUDIO_DEFAULT_LOG_PATH)
   set(RSTUDIO_DEFAULT_LOG_PATH "/var/log/rstudio/rstudio-server")
endif()

# detect architecture
if(UNIX)

   execute_process(
      COMMAND uname -m
      OUTPUT_VARIABLE UNAME_M
      OUTPUT_STRIP_TRAILING_WHITESPACE)

elseif(WIN32)
   set(UNAME_M $ENV{PROCESSOR_ARCHITECTURE})
else()
   set(UNAME_M UnknownArchitecture)
endif()

message(STATUS "Machine architecture: ${UNAME_M}")

# default to debug builds
if(NOT CMAKE_BUILD_TYPE)

   foreach(BUILD_TYPE Debug Release RelWithDebInfo MinSizeRel)
      if(CMAKE_BINARY_DIR MATCHES "${BUILD_TYPE}")
         set(CMAKE_BUILD_TYPE "${BUILD_TYPE}")
         break()
      endif()
   endforeach()

   if(NOT CMAKE_BUILD_TYPE)
      set(CMAKE_BUILD_TYPE Debug)
   endif()


endif()

message(STATUS "CMake build type: ${CMAKE_BUILD_TYPE}")

# enable testing on all builds unless explicitly disabled
if(NOT RSTUDIO_UNIT_TESTS_DISABLED)
  set(RSTUDIO_UNIT_TESTS_ENABLED true)
  add_definitions(-DRSTUDIO_UNIT_TESTS_ENABLED)
endif()

# platform specific default for targets
if(NOT RSTUDIO_TARGET)

   # for macOS pro builds, default to electron as otherwise
   # we will try (and fail) to build Linux-only launcher pieces
   if(APPLE AND RSTUDIO_PRO_BUILD)
      set(RSTUDIO_TARGET "Electron")
   else()
      set(RSTUDIO_TARGET "Development")
   endif()

   # if no target was set, assume this is a development build
   set(RSTUDIO_DEVELOPMENT TRUE)

endif()

# set desktop and server build flags
if(NOT DEFINED RSTUDIO_SERVER)
   if(NOT WIN32 AND (RSTUDIO_TARGET STREQUAL "Development" OR RSTUDIO_TARGET STREQUAL "Server"))
      set(RSTUDIO_SERVER TRUE)
   endif()
endif()

if(NOT DEFINED RSTUDIO_ELECTRON)
   if(RSTUDIO_TARGET STREQUAL "Development" OR RSTUDIO_TARGET STREQUAL "Electron")
      set(RSTUDIO_ELECTRON TRUE)
   endif()
endif()

# make sure RSTUDIO_ELECTRON is defined so it can be used in configure_file
if(NOT DEFINED RSTUDIO_ELECTRON)
   set(RSTUDIO_ELECTRON FALSE)
endif()

# override if requested
if(RSTUDIO_NO_ELECTRON)
   set(RSTUDIO_ELECTRON FALSE)
endif()

# set session32 if specified
if(WIN32)
   if(RSTUDIO_TARGET STREQUAL "SessionWin32")
      set(RSTUDIO_SESSION_WIN32 TRUE)
      add_definitions(-D_X86_)
   else()
      add_definitions(-D_AMD64_)
   endif()
endif()

# record git revision hash (cache it since we don't use this in development
# mode and we don't want it to force rebuilds there)
if(NOT RSTUDIO_SESSION_WIN32 AND NOT RSTUDIO_GIT_REVISION_HASH)
   find_program(GIT_EXECUTABLE git)
   if(GIT_EXECUTABLE)
      execute_process(
         COMMAND git rev-parse HEAD
         WORKING_DIRECTORY "${RSTUDIO_PROJECT_ROOT}"
         OUTPUT_VARIABLE RSTUDIO_GIT_REVISION_HASH
         OUTPUT_STRIP_TRAILING_WHITESPACE)
      SET(RSTUDIO_GIT_REVISION_HASH "${RSTUDIO_GIT_REVISION_HASH}" CACHE STRING "Git Revision Hash")
   endif()
endif()

# record these from Jenkins if available
if("$ENV{GIT_COMMIT}" STREQUAL "")
  string(LENGTH "${RSTUDIO_GIT_REVISION_HASH}" HASH_LENGTH)
  if(HASH_LENGTH EQUAL 40) 
    # use the cached revision hash if we have one
    set(RSTUDIO_GIT_COMMIT "${RSTUDIO_GIT_REVISION_HASH}")
  else()
    # make one up if we don't
    set(RSTUDIO_GIT_COMMIT "99999999999999999999999999999999")
  endif()
else()
  # use the git commit from Jenkins
  set(RSTUDIO_GIT_COMMIT $ENV{GIT_COMMIT})
endif()
if("$ENV{BUILD_ID}" STREQUAL "")
  # no known build ID
  set(RSTUDIO_BUILD_ID "unknown")
else()
  # use build ID from Jenkins
  set(RSTUDIO_BUILD_ID $ENV{BUILD_ID})
endif()
if("$ENV{PACKAGE_OS}" STREQUAL "")
  if(WIN32)
    set(RSTUDIO_PACKAGE_OS "Windows")
  elseif(APPLE)
    set(RSTUDIO_PACKAGE_OS "macOS")
  elseif(LINUX)
    set(RSTUDIO_PACKAGE_OS "Linux")
  else()
    set(RSTUDIO_PACKAGE_OS "Unknown OS")
  endif()
else()
  set(RSTUDIO_PACKAGE_OS $ENV{PACKAGE_OS})
endif()

# required R version
set(RSTUDIO_R_VERSION_REQUIRED "4.0.0")
set(RSTUDIO_R_MAJOR_VERSION_REQUIRED 4)
set(RSTUDIO_R_MINOR_VERSION_REQUIRED 0)
set(RSTUDIO_R_PATCH_VERSION_REQUIRED 0)

# allow opting out of version checking (for building on older distros)
if(NOT DEFINED RSTUDIO_VERIFY_R_VERSION)
   if(RSTUDIO_PACKAGE_BUILD)
      set(RSTUDIO_VERIFY_R_VERSION FALSE)
   else()
      set(RSTUDIO_VERIFY_R_VERSION TRUE)
   endif()
endif()

# pandoc version
set(PANDOC_VERSION "3.2" CACHE INTERNAL "Pandoc version")

# node version used for building product components
set(RSTUDIO_NODE_VERSION "22.13.1" CACHE INTERNAL "Node version for building")

# Check if we're running on Amazon Linux 2
set(IS_AL2 FALSE)
if(LINUX AND OS_RELEASE_PRETTY_NAME STREQUAL "Amazon Linux 2")
   set(IS_AL2 TRUE)
   message(STATUS "Running on Amazon Linux 2: ${IS_AL2}")
endif()

# quarto support

# Note that Quarto support is now always enabled, except on Amazon Linux 2.
#
#   Set QUARTO_ENABLED = TRUE to have RStudio bundle an embedded copy of Quarto (default).
#   Set QUARTO_ENABLED = FALSE to force the use of an external Quarto installation.
#

if (IS_AL2)
   set(QUARTO_ENABLED FALSE CACHE INTERNAL "Internal Quarto enabled")
   message(STATUS "Quarto disabled on Amazon Linux 2")
endif()

if(NOT DEFINED QUARTO_ENABLED)
   set(QUARTO_ENABLED TRUE CACHE INTERNAL "")
endif()

if(QUARTO_ENABLED)
   add_definitions(-DQUARTO_ENABLED)
endif()

message(STATUS "Quarto enabled: ${QUARTO_ENABLED}")

option(RSTUDIO_ENABLE_COPILOT "Enable the GitHub Copilot Feature" ON)
if(RSTUDIO_ENABLE_COPILOT)
   message(STATUS "GitHub Copilot support enabled")
   add_definitions(-DCOPILOT_ENABLED)
else()
   message(STATUS "GitHub Copilot support disabled")
endif()

# install freedesktop integration files if we are installing into /usr
if(NOT DEFINED RSTUDIO_INSTALL_FREEDESKTOP)
   if(${CMAKE_INSTALL_PREFIX} MATCHES "/usr/.*")
      set(RSTUDIO_INSTALL_WITH_PRIV TRUE)
   else()
      set(RSTUDIO_INSTALL_WITH_PRIV FALSE)
   endif()
   if(RSTUDIO_INSTALL_WITH_PRIV AND UNIX AND NOT APPLE)
      set(RSTUDIO_INSTALL_FREEDESKTOP TRUE)
   else()
      set(RSTUDIO_INSTALL_FREEDESKTOP FALSE)
   endif()
endif()

# dependencies
if(WIN32)
   if(EXISTS "C:/rstudio-tools/dependencies")
      set(RSTUDIO_DEPENDENCIES_DIR "C:/rstudio-tools/dependencies")
      set(RSTUDIO_WINDOWS_DEPENDENCIES_DIR "${RSTUDIO_DEPENDENCIES_DIR}/windows")
   else()
      set(RSTUDIO_WINDOWS_DEPENDENCIES_DIR "${RSTUDIO_PROJECT_ROOT}/dependencies/windows")
   endif()
   set(CPACK_DEPENDENCIES_DIR "${RSTUDIO_WINDOWS_DEPENDENCIES_DIR}")
   set(CPACK_NSPROCESS_VERSION "1.6")
else()
   # look for system-wide (global) dependencies folder
   if(EXISTS "/opt/rstudio-tools/dependencies")
      set(RSTUDIO_DEPENDENCIES_DIR "/opt/rstudio-tools/dependencies")
   endif()
endif()

# look for dependencies in the source folder if not installed globally
if(NOT EXISTS "${RSTUDIO_DEPENDENCIES_DIR}")
   set(RSTUDIO_DEPENDENCIES_DIR "${RSTUDIO_PROJECT_ROOT}/dependencies")
endif()

# tools
if(NOT DEFINED RSTUDIO_TOOLS_ROOT)
   if(DEFINED ENV{RSTUDIO_TOOLS_ROOT})
      set(RSTUDIO_TOOLS_ROOT $ENV{RSTUDIO_TOOLS_ROOT})
   elseif(WIN32)
      set(RSTUDIO_TOOLS_ROOT "${RSTUDIO_DEPENDENCIES_DIR}")
   elseif(APPLE)
      find_path(RSTUDIO_TOOLS_ROOT
         NAMES boost
         HINTS
            "$ENV{HOME}/opt/rstudio-tools/${UNAME_M}"
            "/opt/rstudio-tools/${UNAME_M}")
   else()
      set(RSTUDIO_TOOLS_ROOT "/opt/rstudio-tools/${UNAME_M}")
   endif()
endif()

message(STATUS "Using RStudio tools root: ${RSTUDIO_TOOLS_ROOT}")

# special install directories for apple desktop
if (APPLE)
   if (RSTUDIO_ELECTRON)
      set(RSTUDIO_INSTALL_BIN        Rao.app/Contents/Resources/app/bin)
      set(RSTUDIO_INSTALL_SUPPORTING Rao.app/Contents/Resources/app)
      # handles Quarto share when not stored alongside bin
      set(RSTUDIO_INSTALL_RESOURCES Rao.app/Contents/Resources)
   else()
      set(RSTUDIO_INSTALL_BIN        Rao.app/Contents/MacOS)
      set(RSTUDIO_INSTALL_SUPPORTING Rao.app/Contents/Resources)
   endif()
else()
   if (RSTUDIO_ELECTRON)
      if (RSTUDIO_SESSION_WIN32)
         set(RSTUDIO_INSTALL_BIN resources/app/bin/x86)
      else()
         set(RSTUDIO_INSTALL_BIN resources/app/bin)
      endif()
      set(RSTUDIO_INSTALL_SUPPORTING resources/app)
      set(RSTUDIO_INSTALL_ELECTRON .)
   else()
      if (RSTUDIO_SESSION_WIN32)
         set(RSTUDIO_INSTALL_BIN x86)
      else()
         set(RSTUDIO_INSTALL_BIN bin)
      endif()
      set(RSTUDIO_INSTALL_SUPPORTING .)
   endif()
endif()

# if the install prefix is /usr/local then tweak as appropriate
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
   if(APPLE)
      set(CMAKE_INSTALL_PREFIX "/Applications")
   elseif(UNIX)
      if(RSTUDIO_ELECTRON)
         set(CMAKE_INSTALL_PREFIX "/usr/local/lib/rstudio")
      else()
         set(CMAKE_INSTALL_PREFIX "/usr/local/lib/rstudio-server")
      endif()
   endif()
endif()

# detect lsb release
if (UNIX AND NOT APPLE)
   if(NOT RSTUDIO_LSB_RELEASE)
      execute_process(COMMAND /usr/bin/lsb_release "--id" "--short"
                      OUTPUT_VARIABLE RSTUDIO_LSB_RELEASE)
      if (RSTUDIO_LSB_RELEASE)
         string(STRIP ${RSTUDIO_LSB_RELEASE} RSTUDIO_LSB_RELEASE)
         string(TOLOWER  ${RSTUDIO_LSB_RELEASE} RSTUDIO_LSB_RELEASE)
         set(RSTUDIO_LSB_RELEASE ${RSTUDIO_LSB_RELEASE} CACHE STRING "LSB release")
         message(STATUS "LSB release: ${RSTUDIO_LSB_RELEASE}")
      endif()
   endif()
endif()

# make sure the CMAKE_INSTALL_PREFIX uses a cmake style path
file(TO_CMAKE_PATH "${CMAKE_INSTALL_PREFIX}" CMAKE_INSTALL_PREFIX)

# clear embedded packages variable (always do this first so that CMake caches
# are properly flushed / reset whenever we embed an unembed packages)
set(RSTUDIO_EMBEDDED_PACKAGES "" CACHE INTERNAL "Embedded R Packages")

# embedded packages
# set(RSTUDIO_EMBEDDED_PACKAGES rmarkdown rsconnect CACHE INTERNAL "Embedded R Packages")

# include utilities
include(RStudioCMakeUtils)

# define custom function to strip unnecessary path parts from binary filename
function(define_source_file_names targetname)
    get_target_property(SOURCE_FILES "${targetname}" SOURCES)
    foreach(SOURCE_FILE ${SOURCE_FILES})
        # Get source file's current list of compile definitions.
        get_property(SOURCE_DEFS SOURCE "${SOURCE_FILE}" PROPERTY COMPILE_DEFINITIONS)

        # Add the stripped filename to the list
        # Provided source paths can either be full paths or simply filenames
        string(FIND "${SOURCE_FILE}" "/src/cpp" SOURCE_INDEX)
        if (SOURCE_INDEX GREATER -1)
           set(FULL_SOURCE_NAME "${SOURCE_FILE}")
           MATH(EXPR SOURCE_INDEX "${SOURCE_INDEX}+1")
        else()
           string(FIND "${SOURCE_FILE}" "${CMAKE_BINARY_DIR}" SOURCE_INDEX)
           if (SOURCE_INDEX GREATER -1)
              set(FULL_SOURCE_NAME "${SOURCE_FILE}")
              string(LENGTH "${CMAKE_BINARY_DIR}" BINARY_DIR_LENGTH)
              MATH(EXPR SOURCE_INDEX "${SOURCE_INDEX}+${BINARY_DIR_LENGTH}+1")
           else()
              set(FULL_SOURCE_NAME "${CMAKE_CURRENT_SOURCE_DIR}/${SOURCE_FILE}")
              string(FIND "${FULL_SOURCE_NAME}" "/src/cpp" SOURCE_INDEX)
              MATH(EXPR SOURCE_INDEX "${SOURCE_INDEX}+1")
           endif()
        endif()

        string(SUBSTRING "${FULL_SOURCE_NAME}" "${SOURCE_INDEX}" -1 STRIPPED_SOURCE)
        list(APPEND SOURCE_DEFS "STRIPPED_FILENAME=\"${STRIPPED_SOURCE}\"")

        # Set the updated compile definitions on the source file.
        set_property(
            SOURCE "${SOURCE_FILE}"
            PROPERTY COMPILE_DEFINITIONS ${SOURCE_DEFS})
    endforeach()
endfunction()

# define custom installation macro to strip symbols from the binary
macro(add_stripped_executable _target)
   add_executable(${_target} ${ARGN})

   # only strip debug info in release package builds
   if(RSTUDIO_PACKAGE_BUILD AND CMAKE_BUILD_TYPE STREQUAL RelWithDebInfo)
      if(UNIX AND NOT APPLE)
         # strip debug info
         add_custom_command(TARGET ${_target} POST_BUILD
                            COMMAND objcopy --only-keep-debug ${_target} ${_target}.debug
                            COMMAND objcopy --strip-debug --strip-unneeded ${_target}
                            COMMAND objcopy --add-gnu-debuglink=${_target}.debug ${_target}
                            COMMENT "Stripping ${_target}")
      elseif(APPLE)
         
         if(${ARGV1} STREQUAL "MACOSX_BUNDLE")
            set(STRIP_TARGET "${_target}.app/Contents/MacOS/${_target}")
         else()
            set(STRIP_TARGET "${_target}")
         endif()
         
         add_custom_command(TARGET ${_target} POST_BUILD
                            COMMAND dsymutil -o ./${_target}.dSYM ${STRIP_TARGET}
                            COMMAND strip -x -S ${STRIP_TARGET}
                            COMMENT "Stripping ${STRIP_TARGET}")
         
      endif()
   endif()
   define_source_file_names("${_target}")
endmacro(add_stripped_executable)

if(APPLE)

   # set Homebrew prefix directory
   if(NOT DEFINED HOMEBREW_PREFIX)

      if(UNAME_M STREQUAL arm64)
         set(HOMEBREW_PREFIX_FALLBACK /opt/homebrew)
      else()
         set(HOMEBREW_PREFIX_FALLBACK /usr/local)
      endif()
      
      find_path(HOMEBREW_PREFIX
         NAMES bin/brew
         HINTS
            "${HOMEBREW_PREFIX_FALLBACK}")

      message(STATUS "Using Homebrew: ${HOMEBREW_PREFIX}")

   endif()

   # help Boost find icu4c
   if(RSTUDIO_USE_SYSTEM_BOOST)
      link_directories(${HOMEBREW_PREFIX}/opt/icu4c/lib)
   endif()

   # set OPENSSL_ROOT_DIR if unset
   if(NOT DEFINED OPENSSL_ROOT_DIR)

      file(GLOB OPENSSL_ROOT_CANDIDATE "${HOMEBREW_PREFIX}/Cellar/openssl/*")
      if(EXISTS "${OPENSSL_ROOT_CANDIDATE}")
         set(OPENSSL_ROOT_DIR "${OPENSSL_ROOT_CANDIDATE}" CACHE INTERNAL "")
      elseif(EXISTS "${HOMEBREW_PREFIX}/opt/openssl")
         set(OPENSSL_ROOT_DIR "${HOMEBREW_PREFIX}/opt/openssl" CACHE INTERNAL "")
      endif()

   endif()

endif()

# If enabled, use caching for the build
if(SCCACHE_ENABLED)
   include(sccache)
endif()
