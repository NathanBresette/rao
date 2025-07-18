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
project(ELECTRON_DESKTOP)

if (LINUX)

   # add rstudio icon to root (so people installing from source or tar.gz can find it
   install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/resources/freedesktop/icons/48x48/rstudio.png
         DESTINATION ${RSTUDIO_INSTALL_SUPPORTING})

   # install configured backtrace utility on linux
   configure_file(${CMAKE_CURRENT_SOURCE_DIR}/rstudio-backtrace.sh.in
                  ${CMAKE_CURRENT_BINARY_DIR}/rstudio-backtrace.sh)
   install(PROGRAMS ${CMAKE_CURRENT_BINARY_DIR}/rstudio-backtrace.sh
                  DESTINATION ${RSTUDIO_INSTALL_BIN})
endif()


# install desktop integration files on linux
if(RSTUDIO_INSTALL_FREEDESKTOP)

   # define freedesktop dirs
   set(RSTUDIO_FREEDESKTOP_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/resources/freedesktop)
   set(RSTUDIO_FREEDESKTOP_BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/resources/freedesktop)

   # desktop file (dynamically configured with paths)
   configure_file (${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/rstudio.desktop.in
                  ${RSTUDIO_FREEDESKTOP_BINARY_DIR}/rstudio.desktop)
   install(FILES ${RSTUDIO_FREEDESKTOP_BINARY_DIR}/rstudio.desktop
         DESTINATION /usr/share/applications)

   # mime types
   install(FILES ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/rstudio.xml
         DESTINATION /usr/share/mime/packages)

   # define icon dirs
   set(RSTUDIO_ICONS_16 ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/icons/16x16)
   set(RSTUDIO_ICONS_24 ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/icons/24x24)
   set(RSTUDIO_ICONS_32 ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/icons/32x32)
   set(RSTUDIO_ICONS_48 ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/icons/48x48)
   set(RSTUDIO_ICONS_256 ${RSTUDIO_FREEDESKTOP_SOURCE_DIR}/icons/256x256)

   # application icon
   install(FILES ${RSTUDIO_ICONS_32}/rstudio.png
         DESTINATION /usr/share/pixmaps)
   install(FILES ${RSTUDIO_ICONS_16}/rstudio.png
         DESTINATION /usr/share/icons/hicolor/16x16/apps)
   install(FILES ${RSTUDIO_ICONS_24}/rstudio.png
         DESTINATION /usr/share/icons/hicolor/24x24/apps)
   install(FILES ${RSTUDIO_ICONS_32}/rstudio.png
         DESTINATION /usr/share/icons/hicolor/32x32/apps)
   install(FILES ${RSTUDIO_ICONS_48}/rstudio.png
         DESTINATION /usr/share/icons/hicolor/48x48/apps)
   install(FILES ${RSTUDIO_ICONS_256}/rstudio.png
         DESTINATION /usr/share/icons/hicolor/256x256/apps)

   # .RData icon
   install(FILES ${RSTUDIO_ICONS_16}/application-x-r-data.png
         DESTINATION /usr/share/icons/hicolor/16x16/mimetypes)
   install(FILES ${RSTUDIO_ICONS_24}/application-x-r-data.png
         DESTINATION /usr/share/icons/hicolor/24x24/mimetypes)
   install(FILES ${RSTUDIO_ICONS_32}/application-x-r-data.png
         DESTINATION /usr/share/icons/hicolor/32x32/mimetypes)
   install(FILES ${RSTUDIO_ICONS_48}/application-x-r-data.png
         DESTINATION /usr/share/icons/hicolor/48x48/mimetypes)
   install(FILES ${RSTUDIO_ICONS_256}/application-x-r-data.png
         DESTINATION /usr/share/icons/hicolor/256x256/mimetypes)

   # .Rproj icon
   install(FILES ${RSTUDIO_ICONS_16}/application-x-r-project.png
         DESTINATION /usr/share/icons/hicolor/16x16/mimetypes)
   install(FILES ${RSTUDIO_ICONS_24}/application-x-r-project.png
         DESTINATION /usr/share/icons/hicolor/24x24/mimetypes)
   install(FILES ${RSTUDIO_ICONS_32}/application-x-r-project.png
         DESTINATION /usr/share/icons/hicolor/32x32/mimetypes)
   install(FILES ${RSTUDIO_ICONS_48}/application-x-r-project.png
         DESTINATION /usr/share/icons/hicolor/48x48/mimetypes)
   install(FILES ${RSTUDIO_ICONS_256}/application-x-r-project.png
         DESTINATION /usr/share/icons/hicolor/256x256/mimetypes)
endif()

if(APPLE)
   file(GLOB MAC_FILE_TYPE_ICONS ${CMAKE_CURRENT_SOURCE_DIR}/resources/icons/*.icns)
   install(FILES ${MAC_FILE_TYPE_ICONS} DESTINATION ${RSTUDIO_INSTALL_BIN}/../..)
endif()

# Configure into the source directory during builds. This will
# leave a modified file in the source tree. This is OK in our
# build environment since we start with a clean repo for each
# build but will be mildly annoying on a dev machine when using
# make-package (typically only done while working ON make-package).
configure_file (${CMAKE_CURRENT_SOURCE_DIR}/src/main/build-info.ts.in
                ${CMAKE_CURRENT_SOURCE_DIR}/src/main/build-info.ts)

configure_file (${CMAKE_CURRENT_SOURCE_DIR}/src/ui/splash/splash_unversioned.html.in
                ${CMAKE_CURRENT_SOURCE_DIR}/src/ui/splash/splash.html)

# defines NODEJS, NODEJS_PATH
include("${CMAKE_CURRENT_LIST_DIR}/../CMakeNodeTools.txt")

# ensure node is on the path
if (NOT WIN32)
   set(MODIFIED_PATH "${NODEJS_PATH}:$ENV{PATH}")
endif()

set(ELECTRON_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}" CACHE INTERNAL "")
if (APPLE)
   # configure Info.plist
   configure_file (${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in
      ${CMAKE_CURRENT_SOURCE_DIR}/Info.plist)

   # copy sources to build directory. note that the build directory cannot
   # be the "true" CMake directory as some files are resolved relative to
   # the desktop project's relative path in the application structure
   set(ELECTRON_BUILD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../desktop-build-${UNAME_M}" CACHE INTERNAL "")
   file(REMOVE_RECURSE "${ELECTRON_BUILD_DIR}")
   file(MAKE_DIRECTORY "${ELECTRON_BUILD_DIR}")
   file(
      COPY "${CMAKE_CURRENT_SOURCE_DIR}/"
      DESTINATION "${ELECTRON_BUILD_DIR}/"
      REGEX "/.webpack$" EXCLUDE
      REGEX "/build$" EXCLUDE
      REGEX "/bin$" EXCLUDE
      REGEX "/out$" EXCLUDE
      REGEX "/node_modules$" EXCLUDE)
else()
   set(ELECTRON_BUILD_DIR "${ELECTRON_SOURCE_DIR}" CACHE INTERNAL "")
endif()

# define source dependencies
file(GLOB_RECURSE DESKTOP_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.ts")
list(APPEND DESKTOP_SOURCES package.json forge.config.js)

# define custom command for building RStudio with Electron
# note that OUTPUT tells CMake that this command should be used
# if that output does not exist and needs to be created
if (WIN32)

   add_custom_command(
      OUTPUT "${ELECTRON_BUILD_DIR}/out"
      DEPENDS "${DESKTOP_SOURCES}"
      COMMENT "Building desktop (Electron ${UNAME_M})"
      WORKING_DIRECTORY "${ELECTRON_BUILD_DIR}"
      COMMAND ${NPM} run package
   )

else()

   add_custom_command(
      OUTPUT "${ELECTRON_BUILD_DIR}/out"
      DEPENDS "${DESKTOP_SOURCES}"
      COMMENT "Building desktop (Electron ${UNAME_M})"
      WORKING_DIRECTORY "${ELECTRON_BUILD_DIR}"
      COMMAND
         ${CMAKE_COMMAND} -E env
         "PATH=${MODIFIED_PATH}"
         "MAKEFLAGS="
         ${NPM} run package
   )

endif()


# define custom command for fixing up Electron fuses post-hoc
if (WIN32)

   add_custom_command(
      OUTPUT "${ELECTRON_BUILD_DIR}/out/fuses"
      DEPENDS "${DESKTOP_SOURCES}"
      COMMENT "Setting Electron fuses"
      WORKING_DIRECTORY "${ELECTRON_BUILD_DIR}"
      COMMAND ${NPM} run install-fuses
   )

else()

   add_custom_command(
      OUTPUT "${ELECTRON_BUILD_DIR}/out/fuses"
      DEPENDS "${DESKTOP_SOURCES}"
      COMMENT "Setting Electron fuses"
      WORKING_DIRECTORY "${ELECTRON_BUILD_DIR}"
      COMMAND
         ${CMAKE_COMMAND} -E env
         "PATH=${MODIFIED_PATH}"
         "MAKEFLAGS="
         ${NPM} run install-fuses
   )

endif()

# define a target, indicating that building this target
# requires that aforementioned OUTPUT file
# (this effectively "links" this target with that command)
add_custom_target(electron ALL)
add_custom_target(electron_fuses DEPENDS "${ELECTRON_BUILD_DIR}/out/fuses")
add_custom_target(electron_build DEPENDS "${ELECTRON_BUILD_DIR}/out")

# add target dependencies, so we don't build too many things at once
add_dependencies(electron electron_fuses)
add_dependencies(electron_fuses electron_build)
add_dependencies(electron_build rsession diagnostics)
if(TARGET gwt_build)
   add_dependencies(electron_build gwt_build)
endif()

# install binary (except on macOS, which uses a different approach for bundling Electron due
# to additional steps related to creation of a Universal x64/M1 image)
if(WIN32)

   install(
      DIRECTORY "${ELECTRON_BUILD_DIR}/out/Rao-win32-x64/"
      DESTINATION "${RSTUDIO_INSTALL_ELECTRON}")

   # install Visual C++ runtime files
   set(CUSTOM_VCRUNTIME_X86_DIR "${CMAKE_CURRENT_SOURCE_DIR}/resources/vc_redist/x86")
   set(CUSTOM_VCRUNTIME_X64_DIR "${CMAKE_CURRENT_SOURCE_DIR}/resources/vc_redist/x64")

   file(GLOB VCRUNTIME_X86_FILES "${CUSTOM_VCRUNTIME_X86_DIR}/*")
   file(GLOB VCRUNTIME_X64_FILES "${CUSTOM_VCRUNTIME_X64_DIR}/*")

   install( FILES ${VCRUNTIME_X86_FILES} DESTINATION "${RSTUDIO_INSTALL_BIN}/x86")
   install( FILES ${VCRUNTIME_X64_FILES} DESTINATION "${RSTUDIO_INSTALL_BIN}")

elseif(LINUX)

   if(UNAME_M STREQUAL aarch64)
      set(ELECTRON_ARCH arm64)
   else()
      set(ELECTRON_ARCH x64)
   endif()

   install(
      DIRECTORY "${ELECTRON_BUILD_DIR}/out/Rao-linux-${ELECTRON_ARCH}/"
      DIRECTORY_PERMISSIONS
      OWNER_READ OWNER_WRITE OWNER_EXECUTE
      GROUP_READ GROUP_EXECUTE
      WORLD_READ WORLD_EXECUTE
      DESTINATION "${RSTUDIO_INSTALL_ELECTRON}"
      USE_SOURCE_PERMISSIONS
   )

endif()
