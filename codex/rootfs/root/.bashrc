export TERM=xterm-256color
export LANG=C.UTF-8
PS1='\[\033[1;36m\]codex\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]\$ '

# Aliases
alias ll='ls -la'
alias c='codex'
alias cc='codex resume --last'
alias ha-config='cd /homeassistant'
alias ha-logs='cat /homeassistant/home-assistant.log 2>/dev/null || echo "Log not found"'
