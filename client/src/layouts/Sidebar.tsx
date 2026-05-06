import { NavLink, useLocation } from "react-router-dom";
import IconWrapper from "../shared/components/Icon";
import ShortcutTooltip from "../shared/components/ShortcutTooltip";
import { useAuth } from "../stores/AuthContext";
import { UserAvatar } from "../shared/components/UserAvatar";
import {
    DashboardSquare01Icon,
    Task01Icon,
    Video01Icon,
    Calendar02Icon,
    Archive03Icon,
    Settings01Icon,
} from "@hugeicons/core-free-icons";

interface SidebarProps {
    collapsed: boolean;
}

interface NavItem {
    to: string;
    label: string;
    icon: typeof DashboardSquare01Icon;
    shortcutNum: string;
    /** Match nested paths like `/meetings/:id` to the live-meeting nav item. */
    matchPrefixes?: string[];
    end?: boolean;
}

const mainNavItems: NavItem[] = [
    {
        to: "/",
        label: "Dashboard",
        icon: DashboardSquare01Icon,
        shortcutNum: "1",
        end: true,
    },
    { to: "/tasks", label: "Tasks", icon: Task01Icon, shortcutNum: "2" },
    {
        to: "/meeting",
        label: "Live Meeting",
        icon: Video01Icon,
        shortcutNum: "3",
        matchPrefixes: ["/meetings/", "/rooms/"],
    },
    {
        to: "/scheduled",
        label: "Schedule",
        icon: Calendar02Icon,
        shortcutNum: "4",
    },
    {
        to: "/archives",
        label: "Archives",
        icon: Archive03Icon,
        shortcutNum: "5",
    },
];

export default function Sidebar({ collapsed }: SidebarProps) {
    const { user } = useAuth();
    const location = useLocation();

    return (
        <nav className={`sidebar ${collapsed ? "collapsed" : ""}`}>
            <div className="sidebar-nav sidebar-nav-main">
                {mainNavItems.map((item) => (
                    <ShortcutTooltip
                        key={item.to}
                        keys={[item.shortcutNum]}
                        position="right"
                    >
                        <NavLink
                            to={item.to}
                            end={item.end}
                            id={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                            className={({ isActive }) => {
                                const matchedByPrefix =
                                    item.matchPrefixes?.some((prefix) =>
                                        location.pathname.startsWith(prefix),
                                    );
                                return `sidebar-item ${isActive || matchedByPrefix ? "active" : ""}`;
                            }}
                        >
                            <IconWrapper
                                icon={item.icon}
                                size={20}
                                className="sidebar-item-icon"
                            />
                            <span
                                className={`sidebar-item-label ${collapsed ? "collapsed" : ""}`}
                            >
                                {item.label}
                            </span>
                        </NavLink>
                    </ShortcutTooltip>
                ))}
            </div>

            <div className="sidebar-nav sidebar-nav-bottom">
                <div className="sidebar-bottom-divider" />
                <ShortcutTooltip keys={["6"]} position="right">
                    <NavLink
                        to="/preferences"
                        id="nav-preferences"
                        className={({ isActive }) =>
                            `sidebar-item ${isActive ? "active" : ""}`
                        }
                    >
                        <IconWrapper
                            icon={Settings01Icon}
                            size={20}
                            className="sidebar-item-icon"
                        />
                        <span
                            className={`sidebar-item-label ${collapsed ? "collapsed" : ""}`}
                        >
                            Preferences
                        </span>
                    </NavLink>
                </ShortcutTooltip>

                <ShortcutTooltip keys={["7"]} position="right">
                    <NavLink
                        to="/settings"
                        id="nav-settings"
                        className={({ isActive }) =>
                            `sidebar-item sidebar-user-item ${isActive ? "active" : ""}`
                        }
                    >
                        <UserAvatar
                            name={user?.name || ""}
                            profileImage={user?.profileImage}
                            userId={(user as any)?.id || (user as any)?._id}
                            size={28}
                            className="sidebar-user-avatar"
                        />
                        <span
                            className={`sidebar-item-label ${collapsed ? "collapsed" : ""}`}
                        >
                            {user?.name || "User name"}
                        </span>
                    </NavLink>
                </ShortcutTooltip>
            </div>
        </nav>
    );
}
