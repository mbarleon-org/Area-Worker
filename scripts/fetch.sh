#!/usr/bin/env bash

GREEN="\033[1;32m"
ILC="\033[3m"
ORG="\033[1;33m"
RST="\033[0m"

function _info()
{
    echo -e "${ORG}[💡] INFO:\t${RST} ${ILC}$1${RST}"
}

function _success()
{
    echo -e "${GREEN}[✅] SUCCESS:\t${RST} ${ILC}$1${RST}"
}

_info "fetching latest changes from the main branch..."
git pull origin main
_success "fetched latest changes from the main branch!"
_info "updating submodules..."
git submodule update --init --recursive
_success "updated submodules!"
_info "fetching latest changes in submodules..."
git submodule foreach '
  echo "Updating $name..."
  git fetch origin main
  git checkout main
  git pull origin main
'
_success "fetched latest changes in submodules!"
_info "all done! you can now commit and push your changes."
