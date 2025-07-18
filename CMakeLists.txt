#
# CMakeLists.txt
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

cmake_minimum_required(VERSION 3.6.3)

# initialize
include(cmake/init.cmake)

# release name
include(cmake/release.cmake)

# project name
project("Rao [${RSTUDIO_RELEASE_NAME}]")

# set compiler
include(cmake/compiler.cmake)

# project globals
include(cmake/globals.cmake)

# remove previous installation if requested
if(RSTUDIO_UNINSTALL_PREVIOUS)
  install(CODE "execute_process(COMMAND rm -rf \${CMAKE_INSTALL_PREFIX})")
endif()

# install root docs
if (NOT RSTUDIO_SESSION_WIN32)
   # dynamically configure SOURCE with the git revision hash
   INSTALL(CODE "
      execute_process(COMMAND git rev-parse HEAD
                      WORKING_DIRECTORY \"${CMAKE_CURRENT_SOURCE_DIR}\"
                      OUTPUT_VARIABLE RSTUDIO_GIT_REVISION_HASH)
      configure_file (\"${CMAKE_CURRENT_SOURCE_DIR}/SOURCE.in\"
                      \"${CMAKE_CURRENT_BINARY_DIR}/SOURCE\")
   ")

   configure_file(${CMAKE_CURRENT_SOURCE_DIR}/VERSION.in
                  ${CMAKE_CURRENT_BINARY_DIR}/VERSION)

   # install root docs
   include(cmake/install-docs.cmake)
endif()

# overlay
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/CMakeOverlay.txt")
   include(CMakeOverlay.txt)
endif()

# main src
add_subdirectory(src)

# packaging
add_subdirectory(package)

