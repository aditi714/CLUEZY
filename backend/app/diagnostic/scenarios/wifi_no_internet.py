"""Wi-Fi connected but no internet scenario: causes, rules, questions, and remediation actions."""

from typing import Dict, List
from app.diagnostic.types import DiagnosticQuestionDef

SCENARIO_NAME = "Wi-Fi Connected but No Internet"

# 1. Diagnostic Causes catalog for this scenario
CAUSES = {
    "dns_resolution_failure": {
        "title": "DNS Resolution Failure",
        "description": "Network adapter is connected and routing packets, but DNS servers fail to resolve domain names to IP addresses.",
        "base_score": 0.50,
        "fix_action": {
            "title": "Change DNS to Google Public DNS (8.8.8.8 and 8.8.4.4)",
            "steps": [
                "Open Windows Settings (Win + I) > Network & internet > Wi-Fi, then click your connected network properties (or press Win + R, type ncpa.cpl, right-click Wi-Fi > Properties).",
                "Locate 'DNS server assignment' and click Edit (or double-click 'Internet Protocol Version 4 (TCP/IPv4)').",
                "Switch DNS assignment from Automatic (DHCP) to Manual and toggle IPv4 On.",
                "Enter Preferred DNS: 8.8.8.8 and Alternate DNS: 8.8.4.4 (Google Public DNS) or 1.1.1.1 (Cloudflare).",
                "Click Save, then open Command Prompt (Win + R > cmd) and run 'ipconfig /flushdns' (safely clears cached failed domain lookups) and test opening a website.",
            ],
            "expected_result": "Websites resolve by domain name (e.g., https://example.com) and load immediately.",
            "help_guidance": (
                "Here is detailed step-by-step guidance for Windows:\n"
                "1. Press **Windows Key + R** on your keyboard to open the Run dialog.\n"
                "2. Type `ncpa.cpl` and press **Enter** — this opens Network Connections.\n"
                "3. Right-click your active **Wi-Fi** adapter and click **Properties**.\n"
                "4. Select **Internet Protocol Version 4 (TCP/IPv4)** and click **Properties**.\n"
                "5. Select **Use the following DNS server addresses** and enter `8.8.8.8` (Preferred) and `8.8.4.4` (Alternate).\n"
                "6. Click **OK** to save. Finally, open Command Prompt (`cmd`) and run `ipconfig /flushdns` — this safely refreshes your local domain name cache without disconnecting your network."
            ),
        },
    },
    "gateway_connectivity_failure": {
        "title": "Gateway / Router Connectivity Failure",
        "description": "Wi-Fi radio link is established, but local network packets cannot reach or traverse the local default gateway (router).",
        "base_score": 0.35,
        "fix_action": {
            "title": "Power cycle router and reset local Wi-Fi adapter",
            "steps": [
                "Disconnect from Wi-Fi on your Windows laptop using the taskbar network menu.",
                "Unplug the power cable from the back of your Wi-Fi router / gateway.",
                "Wait 30 full seconds so router memory and capacitors completely discharge (note: all devices on Wi-Fi will briefly lose connection during restart).",
                "Plug the power cable back into the router and wait 2 minutes until the Power, Wi-Fi, and Internet/WAN status lights stabilize.",
                "Reconnect your laptop to Wi-Fi and test with 'ping 192.168.1.1' (or your default gateway IP) in Command Prompt.",
            ],
            "expected_result": "Default gateway responds to ping with 0% packet loss and forwards external traffic.",
            "help_guidance": (
                "Here is how to verify and complete the gateway reset safely:\n"
                "1. Note that restarting the router will disconnect all household devices for about 2 minutes.\n"
                "2. Unplug the router's power cord from the wall or back of the unit, wait 30 seconds, and plug it back in.\n"
                "3. On Windows, open Command Prompt (**Win + R**, type `cmd`, press **Enter**).\n"
                "4. Type `ipconfig` to see your **Default Gateway** address (typically `192.168.1.1` or `192.168.0.1`).\n"
                "5. Run `ping <Default-Gateway-IP>` — look for `Reply from ... time<10ms` which confirms your laptop can talk to the router again."
            ),
        },
    },
    "ip_configuration_issue": {
        "title": "Incorrect IP Configuration / DHCP Failure",
        "description": "Device failed to obtain a valid IP lease from DHCP and self-assigned an APIPA address (169.254.x.x) or has IP conflict.",
        "base_score": 0.30,
        "fix_action": {
            "title": "Renew DHCP lease and flush DNS cache",
            "steps": [
                "Press Win + R, type 'cmd', and press Ctrl + Shift + Enter to open Command Prompt as Administrator.",
                "Run 'ipconfig /release' — Purpose: releases your current stuck IP address (Consequence: temporarily drops local network traffic for a few seconds until renewed).",
                "Run 'ipconfig /renew' — Purpose: requests a fresh, valid IPv4 lease and gateway address from your router's DHCP server.",
                "Run 'ipconfig /flushdns' — Purpose: clears stale DNS resolver cache entries.",
                "Check the output of 'ipconfig' and verify 'IPv4 Address' is now in your router's private range (e.g., 192.168.x.x or 10.x.x.x) with a populated Default Gateway.",
            ],
            "expected_result": "A valid DHCP IP lease (192.168.x.x / 10.x.x.x) and Default Gateway are assigned.",
            "help_guidance": (
                "Understanding the Windows DHCP renewal commands:\n"
                "- **What it checks/fixes**: When Windows cannot reach your router's DHCP server, it assigns a fallback `169.254.x.x` (APIPA) address that cannot route to the internet.\n"
                "- **How to execute**: Press **Win + X**, select **Terminal (Admin)** or **Command Prompt (Admin)**.\n"
                "- Run `ipconfig /release` (temporarily clears the invalid IP lease), then immediately run `ipconfig /renew`.\n"
                "- **What result to look for**: Look at the line `IPv4 Address`. If it shows `192.168.x.x` or `10.x.x.x` along with a `Default Gateway`, your DHCP lease is restored."
            ),
        },
    },
    "isp_outage": {
        "title": "ISP Outage / External WAN Down",
        "description": "Local Wi-Fi and router are fully operational, but the internet service provider's external link or fiber line is down.",
        "base_score": 0.25,
        "fix_action": {
            "title": "Verify ISP ONT/Modem uplink and check provider outage status",
            "steps": [
                "Inspect your router and ISP modem/ONT front panel: look for a red, orange, or unlit WAN / Internet / LOS (Loss of Signal) indicator.",
                "Verify the coaxial, Ethernet WAN, or fiber optic patch cable between the wall jack, ONT/modem, and router WAN port is securely seated.",
                "Power-cycle the ISP modem/ONT (unplug for 30 seconds, plug back in, and wait 3 minutes for carrier sync).",
                "Using mobile data on your smartphone, check your ISP's outage map or status dashboard and report a line fault if the WAN light remains red.",
            ],
            "expected_result": "WAN/Internet light turns solid green/white or ISP confirms upstream outage restoration window.",
            "help_guidance": (
                "How to distinguish an ISP outage from a home router issue:\n"
                "1. Your laptop can talk to your Wi-Fi router locally, which is why Wi-Fi shows 'Connected, No Internet'.\n"
                "2. Check the **Internet / Globe / WAN** LED on your router or fiber ONT box.\n"
                "3. A **red or blinking LOS/WAN light** means the physical signal from your ISP outside your home is interrupted.\n"
                "4. You can temporarily enable your smartphone's **Mobile Hotspot** and connect your Windows laptop to it while waiting for your ISP to restore service."
            ),
        },
    },
}


# 2. Diagnostic Rules mapping evidence to score adjustments
# Every adjustment has an identifiable reason explaining why the score changes
RULES: List[Dict] = [
    # Rule 1: Direct IP Reachable (1.1.1.1)
    {
        "evidence_key": "ip_reachable",
        "evaluations": {
            True: [
                {
                    "cause": "dns_resolution_failure",
                    "delta": +0.35,
                    "reason": "Direct IP 1.1.1.1 is reachable while domain names fail, strongly indicating DNS resolution failure.",
                },
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": -0.40,
                    "reason": "Direct internet IP is reachable, proving local gateway is successfully routing packets.",
                },
                {
                    "cause": "ip_configuration_issue",
                    "delta": -0.40,
                    "reason": "Packets reach external IP, verifying network adapter has a valid IP and gateway.",
                },
                {
                    "cause": "isp_outage",
                    "delta": -0.50,
                    "reason": "Internet packets successfully reach Cloudflare (1.1.1.1), ruling out complete ISP outage.",
                    "status_override": "ruled_out",
                },
            ],
            False: [
                {
                    "cause": "dns_resolution_failure",
                    "delta": -0.25,
                    "reason": "Direct IP 1.1.1.1 is unreachable; problem is deeper than DNS (gateway, IP lease, or WAN link failure).",
                },
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": +0.25,
                    "reason": "Inability to ping public IP indicates possible local gateway failure.",
                },
                {
                    "cause": "isp_outage",
                    "delta": +0.25,
                    "reason": "Inability to reach external IP is consistent with WAN link or ISP outage.",
                },
            ],
        },
    },
    # Rule 2: Other Devices on Same Wi-Fi
    {
        "evidence_key": "other_devices_working",
        "evaluations": {
            True: [
                {
                    "cause": "dns_resolution_failure",
                    "delta": +0.15,
                    "reason": "Other devices access internet on the same Wi-Fi, confirming problem is local to this specific device.",
                },
                {
                    "cause": "ip_configuration_issue",
                    "delta": +0.15,
                    "reason": "Wi-Fi is functional for other devices, indicating local adapter configuration or DHCP lease issue on this machine.",
                },
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": -0.25,
                    "reason": "Other devices successfully route through gateway, making total router crash less likely.",
                },
                {
                    "cause": "isp_outage",
                    "delta": -0.55,
                    "reason": "Other devices on the same Wi-Fi have internet, definitively ruling out an ISP outage.",
                    "status_override": "ruled_out",
                },
            ],
            False: [
                {
                    "cause": "isp_outage",
                    "delta": +0.40,
                    "reason": "All devices on the Wi-Fi are unable to connect to the internet, pointing to a network-wide ISP outage.",
                },
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": +0.30,
                    "reason": "All devices lose internet access simultaneously, suggesting local router/gateway lockup.",
                },
                {
                    "cause": "dns_resolution_failure",
                    "delta": -0.15,
                    "reason": "Network-wide failure across all devices is less commonly isolated to a single client DNS misconfiguration.",
                },
            ],
        },
    },
    # Rule 3: Valid IP Address / APIPA Check
    {
        "evidence_key": "has_valid_ip",
        "evaluations": {
            True: [
                {
                    "cause": "ip_configuration_issue",
                    "delta": -0.35,
                    "reason": "Network adapter has a valid subnet IP address, reducing probability of DHCP failure.",
                },
            ],
            False: [
                {
                    "cause": "ip_configuration_issue",
                    "delta": +0.55,
                    "reason": "Adapter has an APIPA (169.254.x.x) or invalid IP address, confirming DHCP assignment failure.",
                    "status_override": "confirmed",
                },
                {
                    "cause": "dns_resolution_failure",
                    "delta": -0.30,
                    "reason": "Without a valid local IP address, DNS cannot function.",
                },
            ],
        },
    },
    # Rule 4: Gateway Ping
    {
        "evidence_key": "gateway_ping_success",
        "evaluations": {
            True: [
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": -0.45,
                    "reason": "Default gateway replies to local ICMP ping, confirming local router link is functional.",
                },
                {
                    "cause": "isp_outage",
                    "delta": +0.15,
                    "reason": "Router responds locally but external traffic fails, consistent with an external WAN drop.",
                },
            ],
            False: [
                {
                    "cause": "gateway_connectivity_failure",
                    "delta": +0.45,
                    "reason": "Device cannot ping its default gateway, pointing to local Wi-Fi router link failure.",
                },
                {
                    "cause": "dns_resolution_failure",
                    "delta": -0.25,
                    "reason": "Cannot communicate with gateway, meaning traffic cannot leave local machine regardless of DNS.",
                },
            ],
        },
    },
    # Rule 5: Router WAN / Internet Status Light
    {
        "evidence_key": "router_wan_down",
        "evaluations": {
            True: [
                {
                    "cause": "isp_outage",
                    "delta": +0.45,
                    "reason": "Router internet/WAN light is red or off, confirming loss of external ISP carrier signal.",
                    "status_override": "confirmed",
                },
                {
                    "cause": "dns_resolution_failure",
                    "delta": -0.35,
                    "reason": "External carrier signal is physically absent; DNS is a downstream symptom of lost WAN.",
                },
            ],
            False: [
                {
                    "cause": "isp_outage",
                    "delta": -0.30,
                    "reason": "Router WAN light indicates healthy physical carrier signal.",
                },
            ],
        },
    },
]


# 3. Diagnostic Questions and Interactive Actions definition
QUESTIONS: List[DiagnosticQuestionDef] = [
    DiagnosticQuestionDef(
        id="check_ip_access",
        question_text=(
            "First diagnostic check: let's test direct IP connectivity to see if packets can reach the internet without DNS.\n\n"
            "• **What this checks**: Whether your internet routing works when bypassing domain names (DNS).\n"
            "• **How to run it**: Open https://1.1.1.1 in your browser, OR press **Win + R**, type `cmd`, press Enter, and run `ping 1.1.1.1` (a safe, read-only network test).\n"
            "• **What to look for**: Does the page open (or do you see `Reply from 1.1.1.1: bytes=32`), or does it say `Request timed out`?"
        ),
        purpose="Differentiates DNS resolution failure from general network, IP configuration, or gateway connectivity loss.",
        discriminates_between=[
            "dns_resolution_failure",
            "ip_configuration_issue",
            "gateway_connectivity_failure",
            "isp_outage",
        ],
        action_type="action",
        command="ping 1.1.1.1",
        options=[
            {
                "label": "It opens",
                "value": "ip_reachable",
                "evidence_key": "ip_reachable",
                "evidence_val": True,
            },
            {
                "label": "It doesn't open",
                "value": "ip_unreachable",
                "evidence_key": "ip_reachable",
                "evidence_val": False,
            },
            {
                "label": "I'm not sure",
                "value": "unknown",
                "evidence_key": "ip_reachable",
                "evidence_val": None,
            },
        ],
    ),
    DiagnosticQuestionDef(
        id="check_other_devices",
        question_text=(
            "Are other devices (such as your smartphone or another computer) able to open websites while connected to the **same Wi-Fi network**?\n\n"
            "• **What this checks**: Whether the problem is isolated to your computer or affects your entire home/office Wi-Fi network and ISP line."
        ),
        purpose="Determines whether the fault is isolated to this computer or affects the entire local network/ISP.",
        discriminates_between=["isp_outage", "dns_resolution_failure", "ip_configuration_issue"],
        action_type="question",
        options=[
            {
                "label": "Yes, other devices work fine",
                "value": "other_devices_ok",
                "evidence_key": "other_devices_working",
                "evidence_val": True,
            },
            {
                "label": "No, all devices have no internet",
                "value": "all_devices_down",
                "evidence_key": "other_devices_working",
                "evidence_val": False,
            },
            {
                "label": "No other devices available to test",
                "value": "unknown",
                "evidence_key": "other_devices_working",
                "evidence_val": None,
            },
        ],
    ),
    DiagnosticQuestionDef(
        id="check_ip_address_validity",
        question_text=(
            "Let's inspect your computer's local IP configuration.\n\n"
            "• **What this checks**: Whether your Wi-Fi router assigned your computer a valid DHCP IP lease.\n"
            "• **How to run it**: On Windows, press **Win + R**, type `cmd`, press Enter, and run `ipconfig` (a safe, read-only status command).\n"
            "• **What to look for**: Under **Wireless LAN adapter Wi-Fi**, look at **IPv4 Address**. Does it start with `192.168.x.x` / `10.x.x.x` (valid private IP), or `169.254.x.x` (APIPA self-assigned fallback meaning DHCP failed)?"
        ),
        purpose="Checks for DHCP lease failure (APIPA address 169.254.x.x) vs valid subnet addressing.",
        discriminates_between=["ip_configuration_issue", "dns_resolution_failure"],
        action_type="action",
        command="ipconfig",
        options=[
            {
                "label": "Standard IP (192.168.x.x or 10.x.x.x)",
                "value": "valid_ip",
                "evidence_key": "has_valid_ip",
                "evidence_val": True,
            },
            {
                "label": "Starts with 169.254 (APIPA / No valid IP)",
                "value": "apipa_ip",
                "evidence_key": "has_valid_ip",
                "evidence_val": False,
            },
            {
                "label": "I'm not sure how to check",
                "value": "unknown",
                "evidence_key": "has_valid_ip",
                "evidence_val": None,
            },
        ],
    ),
    DiagnosticQuestionDef(
        id="check_gateway_ping",
        question_text=(
            "Let's check if your computer can communicate with your local Wi-Fi router (Default Gateway).\n\n"
            "• **What this checks**: Whether packets can travel over Wi-Fi between your laptop and your router.\n"
            "• **How to run it**: In Command Prompt (`cmd`), find your **Default Gateway** from `ipconfig` (usually `192.168.1.1` or `192.168.0.1`) and run `ping 192.168.1.1`.\n"
            "• **What to look for**: `Reply from 192.168.1.1` means the router link works; `Request timed out` or `Destination host unreachable` means the local router link is blocked."
        ),
        purpose="Tests whether layer 2 / layer 3 communication with the local Wi-Fi router is operating.",
        discriminates_between=["gateway_connectivity_failure", "isp_outage"],
        action_type="action",
        command="ping 192.168.1.1",
        options=[
            {
                "label": "Yes, router replies to ping",
                "value": "gateway_reachable",
                "evidence_key": "gateway_ping_success",
                "evidence_val": True,
            },
            {
                "label": "No, request timed out / unreachable",
                "value": "gateway_unreachable",
                "evidence_key": "gateway_ping_success",
                "evidence_val": False,
            },
            {
                "label": "I'm not sure",
                "value": "unknown",
                "evidence_key": "gateway_ping_success",
                "evidence_val": None,
            },
        ],
    ),
    DiagnosticQuestionDef(
        id="check_router_lights",
        question_text=(
            "If you can see your Wi-Fi router or ISP modem, what color is the **Internet / WAN / Globe** status light on the front panel?\n\n"
            "• **What this checks**: Whether your router has a live physical signal from your Internet Service Provider (ISP)."
        ),
        purpose="Direct physical check for external optical/coaxial WAN synchronization from the ISP.",
        discriminates_between=["isp_outage", "dns_resolution_failure"],
        action_type="physical_check",
        options=[
            {
                "label": "Green / White (Normal online state)",
                "value": "lights_normal",
                "evidence_key": "router_wan_down",
                "evidence_val": False,
            },
            {
                "label": "Red / Orange / Blinking / Off (Error state)",
                "value": "lights_error",
                "evidence_key": "router_wan_down",
                "evidence_val": True,
            },
            {
                "label": "Cannot access or view router",
                "value": "unknown",
                "evidence_key": "router_wan_down",
                "evidence_val": None,
            },
        ],
    ),
]
