!macro customInstall
  DetailPrint "Adding Windows Firewall rules for Android Control Center..."
  
  # Remove any existing rule with this name to avoid duplicates during updates
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Android Control Center"'
  
  # Add inbound rule for the final installed executable on Private profiles
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Android Control Center" dir=in action=allow program="$INSTDIR\Android Control Center.exe" enable=yes profile=private'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rules for Android Control Center..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Android Control Center"'
!macroend
